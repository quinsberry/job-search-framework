"""Import observed vacancies, report changes, and remember explicit review choices."""

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

# Reuse the existing search contract; history never reimplements fit evaluation.
from .search_contract import ValidationError, canonical_url, criteria, identities, timestamp


STATES = {"unreviewed", "shortlisted", "dismissed"}
EDITABLE = {'title', 'company', 'location', 'description', 'url', 'work_type', 'advertised_compensation', 'notes'}
FIELDS = ("title", "company", "location", "description", "seniority_label", "employment_type", "active")


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def encoded(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"
    except (TypeError, ValueError):
        raise ValidationError("input must contain finite JSON data") from None


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def normalized(value):
    return " ".join(value.casefold().split()) if isinstance(value, str) else value


def empty_history():
    return {"schema_version": 1, "vacancies": {}, "redirects": {}, "scopes": {}, "imports": []}


def resolve(history, identifier):
    seen = set()
    while identifier in history["redirects"]:
        require(identifier not in seen, "history contains cyclic redirects")
        seen.add(identifier)
        identifier = history["redirects"][identifier]
    return identifier


def validate(history):
    require(isinstance(history, dict) and set(history) == {"schema_version", "vacancies", "redirects", "scopes", "imports"}, "invalid history schema")
    require(type(history["schema_version"]) is int and history["schema_version"] == 1, "history schema_version must be 1")
    require(all(isinstance(history[k], dict) for k in ("vacancies", "redirects", "scopes")) and isinstance(history["imports"], list), "invalid history collections")
    require(all(isinstance(x, str) for x in history["imports"]), "invalid import IDs")
    aliases = set()
    for identifier, record in history["vacancies"].items():
        require(isinstance(record, dict) and record.get("id") == identifier, "invalid vacancy ID")
        require(isinstance(record.get("aliases"), list) and all(isinstance(x, str) for x in record["aliases"]), "invalid aliases")
        require(not aliases.intersection(record["aliases"]), "history contains overlapping vacancy identities")
        aliases.update(record["aliases"])
        for key in ("observations", "assessments"):
            require(isinstance(record.get(key), dict), f"invalid {key}")
            for item in record[key].values():
                require(isinstance(item, dict), "invalid history entry")
                first = timestamp(item.get("first_seen"), "first_seen")
                last = timestamp(item.get("last_seen"), "last_seen")
                require(first <= last, "history timestamps are reversed")
                require(isinstance(item.get("posting" if key == "observations" else "assessment"), dict), "invalid history payload")
        require(bool(record["observations"]), "vacancy has no observations")
        review = record.get("review")
        require(isinstance(review, dict) and isinstance(review.get("state"), str) and review["state"] in STATES, "invalid review state")
        require(isinstance(record.get("review_conflicts"), list), "invalid review conflicts")
        require(isinstance(record.get('overrides', {}), dict), 'invalid vacancy corrections')
        for field, correction in record.get('overrides', {}).items():
            require(field in EDITABLE and isinstance(correction, dict) and isinstance(correction.get('value'), str), 'invalid vacancy correction')
            timestamp(correction.get('at'), 'correction.at')
        if review.get("at") is not None:
            timestamp(review["at"], "review.at")
    for old in history["redirects"]:
        require(resolve(history, old) in history["vacancies"], "redirect references a missing vacancy")
    for scope in history["scopes"].values():
        require(isinstance(scope, dict) and isinstance(scope.get("known"), list) and isinstance(scope.get("seen"), list) and isinstance(scope.get("coverage"), dict), "invalid search scope")
        timestamp(scope.get("observed_at"), "scope.observed_at")
        require(all(isinstance(x, str) and resolve(history, x) in history["vacancies"] for x in scope["known"] + scope["seen"]), "scope references a missing vacancy")
    return history


def source_state(posting):
    status = posting.get("fetch_status", "ok")
    if status == "not_found":
        return "unavailable"
    if status in {"error", "duplicate"}:
        return "uncertain"
    if posting.get("active") is False:
        return "closed"
    if posting.get("active") is True:
        return "open"
    return "available" if status == "ok" and posting.get("description") else "uncertain"


def view(record):
    observations = list(record["observations"].values())
    latest = max(o["last_seen"] for o in observations)
    current = [o for o in observations if o["last_seen"] == latest]
    states = {source_state(o["posting"]) for o in current}
    availability = next(iter(states)) if len(states) == 1 else "uncertain"
    known, conflicts = {}, []
    for field in FIELDS:
        candidates = [o for o in observations if o["posting"].get(field) not in (None, "") and not (field == "active" and o["posting"].get("fetch_status") in {"not_found", "error", "duplicate"})]
        if not candidates:
            continue
        last = max(o["last_seen"] for o in candidates)
        candidates = [o for o in candidates if o["last_seen"] == last]
        values = {encoded(normalized(o["posting"][field])) for o in candidates}
        if len(values) > 1:
            conflicts.append(field)
        else:
            chosen = min(candidates, key=lambda o: digest(o["posting"]))
            known[field] = {"value": chosen["posting"][field], "observed_at": last}
    if availability == "available" and known.get("active", {}).get("value") is False:
        availability = "uncertain"  # A newer accessible page does not explicitly prove reopening.
    assessment = record["assessments"].get(record.get("latest_assessment"))
    return {"vacancy_id": record["id"], "aliases": record["aliases"], "known": known,
            "first_seen": min(o["first_seen"] for o in observations), "last_seen": latest,
            "availability": availability, "field_conflicts": conflicts,
            "corrections": record.get('overrides', {}),
            "review": record["review"], "review_conflicts": record["review_conflicts"],
            "latest_assessment": assessment}


def correct(existing, identifier, changes, at):
    """Store user corrections separately from immutable source observations."""
    history = deepcopy(validate(existing))
    identifier = resolve(history, identifier)
    require(identifier in history['vacancies'], 'unknown vacancy')
    require(isinstance(changes, dict) and bool(changes) and not set(changes) - EDITABLE, 'invalid correction fields')
    require(all(isinstance(v, str) for v in changes.values()), 'corrections must be strings')
    if 'url' in changes:
        url = canonical_url(changes['url'])
        require(not any(r['vacancy_id'] != identifier and canonical_url(r['values']['url']) == url for r in _summaries(history)),
                'This URL belongs to another tracked vacancy; resolve its identity before changing the link.')
    if 'work_type' in changes:
        require(changes['work_type'] in {'', 'remote', 'hybrid', 'onsite'}, 'invalid work arrangement')
    at = timestamp(at, 'correction time').isoformat(timespec='microseconds')
    corrections = history['vacancies'][identifier].setdefault('overrides', {})
    for field, value in changes.items():
        require(field not in corrections or at >= corrections[field]['at'], 'correction precedes an existing edit')
        if corrections.get(field, {}).get('value') != value:
            corrections[field] = {'value': value, 'at': at}
    return history


def _summaries(history):
    """Hide observation, assessment and redirect storage from consumers."""
    result = []
    for identifier, record in sorted(history['vacancies'].items()):
        observed = view(record)
        assessment = (observed['latest_assessment'] or {}).get('assessment', {})
        posting = max(record['observations'].values(), key=lambda o: o['last_seen'])['posting']
        values = {key: item['value'] for key, item in observed['known'].items()}
        arrangements = assessment.get('facts', {}).get('work_arrangements', {})
        arrangements = arrangements.get('value', []) if isinstance(arrangements, dict) else []
        values.update(url=posting['url'], work_type=arrangements[0] if len(arrangements) == 1 else posting.get('work_type', ''),
                      advertised_compensation='; '.join(f"{b.get('low', '')}–{b.get('high', '')} {b.get('currency', '')}/{b.get('period', '')} {b.get('contract', '')} {b.get('basis', '')}" for b in assessment.get('advertised_compensation', [])), notes='')
        values.update({key: item['value'] for key, item in record.get('overrides', {}).items()})
        aliases = sorted(set(record['aliases']) | {'url:' + canonical_url(values['url'])})
        result.append({'vacancy_id': identifier, 'values': values, 'aliases': aliases,
                       'previous_ids': [key for key in history['redirects'] if resolve(history, key) == identifier],
                       'revision': digest(record), 'fit': assessment.get('status', 'unassessed'),
                       'checks': assessment.get('checks', []), 'review': observed['review']['state'],
                       'availability': observed['availability'], 'original': observed['known'],
                       'corrected_fields': sorted(record.get('overrides', {}))})
    return deepcopy(result)


def query(workspace):
    """Read-only v1 display/identity interface; never exposes history containers."""
    return {'schema_version': 1, 'vacancies': _summaries(load(workspace))}


def known_identities(workspace):
    history = load(workspace)
    identities = set().union(*(set(r['aliases']) for r in history['vacancies'].values())) if history['vacancies'] else set()
    return {'schema_version': 1, 'identities': sorted(identities)}


def edit(workspace, identifier, field, value, at):
    history = load(workspace)
    updated = review(history, identifier, value, at) if field == 'review' else correct(history, identifier, {field: value}, at)
    save(workspace, updated)


def adopt(workspace, applications, at):
    history = load(workspace)
    for application in applications:
        history = register_application(history, application, at)
    if applications:
        save(workspace, history)


def register_application(existing, application, at):
    """Explicitly bring an existing application into the editable vacancy list."""
    history = deepcopy(validate(existing))
    url = canonical_url(application['vacancy_link'])
    posting = {'source': 'application', 'url': url, 'title': application.get('position') or None,
               'company': application.get('company') or None, 'description': None,
               'fetch_status': 'unverified', 'origin': 'user application record',
               'work_type': application.get('work_type', '')}
    primary, keys = identities(posting)
    old_id = application.get('vacancy_id')
    if old_id:
        keys.add(old_id)
    matching = [key for key, r in history['vacancies'].items() if set(r['aliases']) & keys]
    if matching:
        record = merge_records(history, matching)
    else:
        record = {'id': primary, 'aliases': [], 'observations': {}, 'assessments': {},
                  'review': {'state': 'unreviewed', 'at': None, 'note': ''}, 'review_conflicts': []}
        history['vacancies'][primary] = record
    record['aliases'] = sorted(set(record['aliases']) | keys)
    if old_id and old_id != record['id'] and old_id not in history['vacancies']:
        history['redirects'][old_id] = record['id']
    at = timestamp(at, 'import time').isoformat(timespec='microseconds')
    if not matching:
        add_entry(record['observations'], digest(posting), {'posting': posting}, at)
    return validate(history)


def scope_key(c):
    filters = deepcopy(c)
    for key in ("target_count", "discovery_budget", "conversions", "preferences"):
        filters.pop(key, None)
    filters["technical"].pop("preferred", None)
    filters["vacancy_types"].pop("preferred", None)
    def unordered(value):
        if isinstance(value, dict):
            return {k: unordered(v) for k, v in value.items()}
        return sorted(value) if isinstance(value, list) else value
    return digest(unordered(filters))


def add_entry(collection, identifier, payload, at):
    if identifier in collection:
        collection[identifier]["first_seen"] = min(collection[identifier]["first_seen"], at)
        collection[identifier]["last_seen"] = max(collection[identifier]["last_seen"], at)
    else:
        collection[identifier] = {**deepcopy(payload), "first_seen": at, "last_seen": at}


def merge_records(history, identifiers):
    survivor = min(identifiers)
    target = history["vacancies"][survivor]
    for old in sorted(set(identifiers) - {survivor}):
        other = history["vacancies"].pop(old)
        target["aliases"] = sorted(set(target["aliases"]) | set(other["aliases"]))
        for field, correction in other.get('overrides', {}).items():
            current = target.setdefault('overrides', {}).get(field)
            if current is None or correction['at'] > current['at']:
                target['overrides'][field] = deepcopy(correction)
            elif correction['at'] == current['at'] and correction['value'] != current['value']:
                raise ValidationError('identity merge has conflicting simultaneous user corrections')
        for key in ("observations", "assessments"):
            for entry_id, entry in other[key].items():
                add_entry(target[key], entry_id, entry, entry["first_seen"])
                add_entry(target[key], entry_id, entry, entry["last_seen"])
        if target["review"]["at"] is None:
            target["review"] = deepcopy(other["review"])
        elif other["review"]["at"] is not None and target["review"]["state"] != other["review"]["state"]:
            target["review_conflicts"].append(deepcopy(other["review"]))
        elif other["review"]["at"] is not None and other["review"]["at"] > target["review"]["at"]:
            target["review"] = deepcopy(other["review"])
        target["review_conflicts"].extend(deepcopy(other["review_conflicts"]))
        candidates = [x for x in (target.get("latest_assessment"), other.get("latest_assessment")) if x in target["assessments"]]
        if candidates:
            target["latest_assessment"] = max(candidates, key=lambda x: (target["assessments"][x]["last_seen"], x))
        history["redirects"][old] = survivor
    return target


def assessment_signature(entry):
    if entry is None:
        return None
    row = entry["assessment"]
    return {"status": row.get("status"), "checks": sorted((x["criterion"], x["status"]) for x in row.get("checks", []))}


def import_results(existing, result):
    history = deepcopy(validate(existing))
    require(isinstance(result, dict) and result.get("schema_version") == 1, "input must be a jsf-search result")
    c = criteria(result.get("criteria"))
    snapshot = result.get("snapshot")
    require(isinstance(snapshot, dict) and snapshot.get("schema_version") == 1 and isinstance(snapshot.get("vacancies"), list), "result needs its complete snapshot")
    at = timestamp(snapshot.get("observed_at"), "snapshot.observed_at").isoformat(timespec="microseconds")
    if snapshot.get("interpreted_for") is not None:
        require(criteria(snapshot["interpreted_for"]) == c, "snapshot was interpreted for different criteria")
    coverage = deepcopy(result.get("coverage", snapshot.get("coverage", {})))
    require(isinstance(coverage, dict), "coverage must be an object")
    rows = result.get("assessments")
    if rows is None:
        rows = sum((result.get(key, []) for key in ("matches", "needs_clarification", "rejected")), [])
    require(isinstance(rows, list) and all(isinstance(r, dict) and r.get("status") in {"match", "rejected", "needs_clarification"} for r in rows), "invalid search assessments")
    row_aliases = []
    for row in rows:
        aliases = row.get("aliases")
        if aliases is None:
            _, aliases = identities(row)
        require(isinstance(aliases, (list, set)) and all(isinstance(x, str) for x in aliases), "invalid assessment aliases")
        row_aliases.append(set(aliases))
    groups = []
    for vacancy in snapshot["vacancies"]:
        require(isinstance(vacancy, dict) and vacancy.get("source") in c["sources"] and isinstance(vacancy.get("facts", {}), dict), "invalid raw vacancy")
        for field in FIELDS:
            require(vacancy.get(field) is None or (type(vacancy[field]) is bool if field == "active" else isinstance(vacancy[field], str)), f"invalid vacancy {field}")
        _, keys = identities(vacancy)
        group = {"keys": keys, "members": [vacancy]}
        for previous in [g for g in groups if g["keys"] & keys]:
            group["keys"].update(previous["keys"])
            group["members"].extend(previous["members"])
            groups.remove(previous)
        groups.append(group)
    all_aliases = set().union(*(g["keys"] for g in groups)) if groups else set()
    require(all(aliases & all_aliases for aliases in row_aliases), "assessment references a vacancy absent from the snapshot")
    import_id = digest([c, at, snapshot["vacancies"], rows, coverage])
    report = {key: [] for key in ("new", "unchanged", "changed", "closed", "uncertain", "assessment_changed", "unassessed", "not_observed")}
    if import_id in history["imports"]:
        return {"schema_version": 1, "replayed": True, "history": history, "report": report}
    seen = set()
    for group in sorted(groups, key=lambda g: min(identities(v)[0] for v in g["members"])):
        matching = [key for key, r in history["vacancies"].items() if set(r["aliases"]) & group["keys"]]
        is_new = not matching
        if is_new:
            identifier = min(identities(v)[0] for v in group["members"])
            require(identifier not in history["vacancies"] and identifier not in history["redirects"], "vacancy identity collision")
            record = {"id": identifier, "aliases": [], "observations": {}, "assessments": {},
                      "review": {"state": "unreviewed", "at": None, "note": ""}, "review_conflicts": []}
            history["vacancies"][identifier] = record
        else:
            record = merge_records(history, matching)
        record["aliases"] = sorted(set(record["aliases"]) | group["keys"])
        for vacancy in group["members"]:
            posting = {k: deepcopy(v) for k, v in vacancy.items() if k != "facts"}
            posting["url"] = canonical_url(posting["url"])
            comparable = {k: normalized(v) if k in FIELDS else v for k, v in posting.items()}
            add_entry(record["observations"], digest(comparable), {"posting": posting}, at)
        associated = []
        for row, aliases in zip(rows, row_aliases):
            if aliases & group["keys"]:
                associated.append(row)
        if not associated:
            associated = [{"status": "unassessed", "checks": [], "facts": [v.get("facts", {}) for v in group["members"]]}]
            report["unassessed"].append(record["id"])
        for row in associated:
            assessment_id = digest([c, row])
            add_entry(record["assessments"], assessment_id, {"criteria": c, "assessment": row}, at)
            prior = record["assessments"].get(record.get("latest_assessment"))
            if prior is None or at >= prior["last_seen"]:
                record["latest_assessment"] = assessment_id
        seen.add(record["id"])
    seen = {resolve(history, key) for key in seen}
    report["unassessed"] = sorted({resolve(history, key) for key in report["unassessed"]})
    for identifier in sorted(seen):
        record = history["vacancies"][identifier]
        prior_ids = [key for key in existing["vacancies"] if resolve(history, key) == identifier]
        before = None
        if prior_ids:
            component = empty_history()
            component["vacancies"] = {key: deepcopy(existing["vacancies"][key]) for key in prior_ids}
            before = view(merge_records(component, prior_ids))
        after = view(record)
        differences = [] if before is None else [field for field in FIELDS if field in after["known"] and normalized(after["known"][field]["value"]) != normalized(before["known"].get(field, {}).get("value"))]
        report["new" if before is None else "changed" if differences else "unchanged"].append({"vacancy_id": record["id"], "fields": differences, "review_state": record["review"]["state"]})
        if after["availability"] == "closed":
            report["closed"].append(record["id"])
        if after["availability"] in {"uncertain", "unavailable"} or after["field_conflicts"] or after["review_conflicts"]:
            report["uncertain"].append(record["id"])
        if before is not None and assessment_signature(before["latest_assessment"]) != assessment_signature(after["latest_assessment"]):
            report["assessment_changed"].append({"vacancy_id": record["id"], "before": assessment_signature(before["latest_assessment"]), "after": assessment_signature(after["latest_assessment"])})
    scope_id = scope_key(c)
    scope = history["scopes"].get(scope_id)
    known = seen | ({resolve(history, x) for x in scope["known"]} if scope else set())
    if scope is None or at >= scope["observed_at"]:
        if scope is not None and at == scope["observed_at"]:
            seen |= {resolve(history, x) for x in scope["seen"]}
        history["scopes"][scope_id] = {"criteria": c, "observed_at": at, "known": sorted(known), "seen": sorted(seen), "coverage": coverage}
        report["not_observed"] = sorted(known - seen)
    else:
        scope["known"] = sorted(known)  # Historical imports enrich scope membership without rewinding its latest observation.
    history["imports"].append(import_id)
    return {"schema_version": 1, "replayed": False, "scope_id": scope_id, "history": validate(history), "report": report}


def review(existing, identifier, state, at, note=""):
    history = deepcopy(validate(existing))
    require(state in STATES and isinstance(note, str), "invalid review choice")
    at = timestamp(at, "review time").isoformat(timespec="microseconds")
    if identifier.startswith(("http://", "https://")):
        identifier = "url:" + canonical_url(identifier)
    identifier = resolve(history, identifier)
    candidates = [r for key, r in history["vacancies"].items() if key == identifier or identifier in r["aliases"]]
    require(len(candidates) == 1, "provide one known vacancy ID or URL")
    record = candidates[0]
    times = [x["at"] for x in [record["review"]] + record["review_conflicts"] if x.get("at")]
    require(not times or at >= max(times), "review time precedes an existing choice")
    require(record["review"]["at"] != at or record["review"] == {"state": state, "at": at, "note": note}, "different choices require different review times")
    record["review"] = {"state": state, "at": at, "note": note}
    record["review_conflicts"] = []
    return history


def read(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValidationError(f"cannot read JSON: {exc}") from None


def load(workspace):
    path = Path(workspace) / "vacancies" / "history.json"
    return validate(read(path)) if path.exists() else empty_history()


def save(workspace, history):
    # shortcut: one writer per workspace; serialize scheduled runs if concurrent writers are introduced.
    content = encoded(validate(history))
    path = Path(workspace) / "vacancies" / "history.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".history.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    importing = sub.add_parser("import")
    importing.add_argument("--results", required=True)
    importing.add_argument("--dry-run", action="store_true")
    listing = sub.add_parser("list")
    listing.add_argument("--state", choices=sorted(STATES))
    reviewing = sub.add_parser("review")
    reviewing.add_argument("--vacancy-id", required=True)
    reviewing.add_argument("--state", required=True, choices=sorted(STATES))
    reviewing.add_argument("--at", required=True)
    reviewing.add_argument("--note", default="")
    correcting = sub.add_parser('correct')
    correcting.add_argument('--vacancy-id', required=True)
    correcting.add_argument('--changes', required=True, help='JSON file containing user correction fields')
    correcting.add_argument('--at', required=True)
    for command in (importing, listing, reviewing, correcting):
        command.add_argument("--workspace", required=True)
    args = parser.parse_args()
    try:
        require(bool(args.workspace.strip()), "workspace is required")
        history = load(args.workspace)
        if args.command == "import":
            result = import_results(history, read(args.results))
            if not args.dry_run and not result["replayed"]:
                save(args.workspace, result["history"])
        elif args.command == "review":
            updated = review(history, args.vacancy_id, args.state, args.at, args.note)
            if updated != history:
                save(args.workspace, updated)
            result = {"schema_version": 1, "vacancies": [view(r) for r in updated["vacancies"].values()]}
        elif args.command == 'correct':
            updated = correct(history, args.vacancy_id, read(args.changes), args.at)
            if updated != history:
                save(args.workspace, updated)
            result = {'schema_version': 1, 'vacancies': [view(r) for r in updated['vacancies'].values()]}
        else:
            result = {"schema_version": 1, "vacancies": [view(r) for _, r in sorted(history["vacancies"].items()) if args.state is None or r["review"]["state"] == args.state]}
        sys.stdout.write(encoded(result))
        return 0
    except (ValidationError, OSError, KeyError, TypeError, ValueError) as exc:
        sys.stderr.write(f"jsf-vacancies: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

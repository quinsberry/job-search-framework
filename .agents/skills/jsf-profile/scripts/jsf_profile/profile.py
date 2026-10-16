"""CV text extraction, pure profile planning, and explicit workspace persistence."""

import argparse
from copy import deepcopy
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile


class ValidationError(ValueError):
    pass


FIELDS = {
    "identity": ["full_name", "location", "email", "phone", "links", "summary"],
    "experience": ["company", "role", "start_date", "end_date", "location", "achievements", "technologies"],
    "skills": ["name", "level", "context"],
    "projects": ["name", "role", "description", "technologies", "outcomes", "url"],
    "education": ["institution", "qualification", "field", "start_date", "end_date"],
    "languages": ["name", "level"],
    "certifications": ["name", "issuer", "date", "expiry_date"],
}
EXPECTED = {
    "identity": ["full_name"], "experience": ["company", "role", "start_date", "end_date"],
    "skills": ["name", "level"], "projects": ["name", "description"],
    "education": ["institution", "qualification"], "languages": ["name", "level"],
    "certifications": ["name", "issuer"],
}


def normalized(value):
    return " ".join(value.casefold().split())


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"


def digest(value):
    return hashlib.sha256(encoded(value).encode("utf-8")).hexdigest()


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def string(value, name):
    require(isinstance(value, str) and bool(value.strip()), f"{name} must be a nonempty string")
    return value


def string_list(value, name):
    require(isinstance(value, list), f"{name} must be a list")
    for item in value:
        string(item, name)
    return value


def empty_profile():
    return {"schema_version": 1, "sources": {}, "records": [], "issues": [], "conflicts": []}


def extract(path, kind="cv"):
    path = Path(path)
    require(kind in {"cv", "user"}, "source kind must be cv or user")
    suffix = path.suffix.casefold()
    require(suffix in {".pdf", ".md"}, "CV input must be .pdf or .md")
    require(kind != "user" or suffix == ".md", "explicit user statements must be supplied as Markdown")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ValidationError(f"cannot read source: {exc}") from None
    pages, issues = [], []
    if suffix == ".md":
        try:
            pages = [{"page": 1, "text": raw.decode("utf-8-sig")}]
        except UnicodeDecodeError:
            raise ValidationError("Markdown source must use UTF-8") from None
    else:
        try:
            from pypdf import PdfReader
        except ImportError:
            raise ValidationError("PDF extraction needs pypdf; install scripts/requirements.txt in your Python environment") from None
        try:
            reader = PdfReader(io.BytesIO(raw))
            if reader.is_encrypted and not reader.decrypt(""):
                issues.append("PDF is encrypted; provide an unlocked copy or Markdown text")
            else:
                for index, page in enumerate(reader.pages, 1):
                    try:
                        content = page.extract_text() or ""
                    except Exception as exc:
                        content = ""
                        issues.append(f"PDF page {index} extraction failed: {type(exc).__name__}")
                    pages.append({"page": index, "text": content})
        except Exception as exc:
            issues.append(f"PDF could not be read: {type(exc).__name__}; provide a readable PDF or Markdown")
    for page in pages:
        if not page["text"].strip():
            issues.append(f"Page {page['page']} has no extractable text; it may be scanned or blank")
    if not pages:
        issues.append("Source contains no extracted pages")
    readable = any(p["text"].strip() for p in pages)
    identifier = hashlib.sha256(kind.encode() + b"\0" + raw).hexdigest()
    source = {"id": identifier, "name": path.name, "path": str(path.resolve()), "kind": kind, "format": suffix[1:],
              "pages": pages, "issues": sorted(set(issues))}
    return {"schema_version": 1, "outcome": "needs_clarification" if not readable else "partial" if issues else "ready", "source": source}


def validate_source(source):
    require(isinstance(source, dict) and {"id", "name", "kind", "format", "pages", "issues"} <= set(source) and not set(source) - {"id", "name", "path", "kind", "format", "pages", "issues"}, "invalid source snapshot fields")
    require(isinstance(source["id"], str) and re.fullmatch(r"[0-9a-f]{64}", source["id"]), "source.id must be a content digest")
    string(source["name"], "source.name")
    require(isinstance(source["kind"], str) and isinstance(source["format"], str) and source["kind"] in {"cv", "user"} and source["format"] in {"pdf", "md"}, "invalid source kind or format")
    if "path" in source:
        require(isinstance(source["path"], str) and Path(source["path"]).is_absolute(), "source.path must be absolute")
    require(source["kind"] != "user" or source["format"] == "md", "user statements must be Markdown")
    require(isinstance(source["pages"], list), "source.pages must be a list")
    seen = set()
    for page in source["pages"]:
        require(isinstance(page, dict) and set(page) == {"page", "text"}, "invalid source page")
        require(type(page["page"]) is int and page["page"] > 0 and page["page"] not in seen, "source page numbers must be positive and unique")
        require(isinstance(page["text"], str), "source page text must be a string")
        seen.add(page["page"])
    string_list(source["issues"], "source.issues")


def validate_evidence(entries, sources):
    require(isinstance(entries, list), "fact.evidence must be a list")
    for entry in entries:
        require(isinstance(entry, dict) and set(entry) == {"source_id", "page", "quote"}, "evidence requires source_id, page and quote")
        require(isinstance(entry["source_id"], str) and entry["source_id"] in sources, "evidence references an unknown source")
        require(type(entry["page"]) is int, "evidence page must be an integer")
        quote = string(entry["quote"], "evidence.quote")
        pages = [p for p in sources[entry["source_id"]]["pages"] if p["page"] == entry["page"]]
        require(bool(pages) and normalized(quote) in normalized(pages[0]["text"]), "evidence quote does not occur on the specified source page")


def validate_fact(fact, sources, patch=False):
    allowed = {"value", "evidence", "correction" if patch else "user_corrected"}
    require(isinstance(fact, dict) and {"value", "evidence"} <= set(fact) and not set(fact) - allowed, "fact requires value and evidence")
    value = fact["value"]
    if value is not None:
        if isinstance(value, list):
            string_list(value, "fact.value")
            require(bool(value), "use null for an unknown/cleared fact rather than an empty list")
        else:
            string(value, "fact.value (quote YAML dates)")
        require(bool(fact["evidence"]), "non-null facts require source evidence")
    validate_evidence(fact["evidence"], sources)
    flag = fact.get("correction" if patch else "user_corrected", False)
    require(type(flag) is bool, "correction flags must be boolean")
    if flag:
        require(any(sources[e["source_id"]]["kind"] == "user" for e in fact["evidence"]), "explicit corrections require evidence from user statements")


def validate_records(records, sources, patch=False):
    require(isinstance(records, list), "records must be a list")
    identifiers, identities = set(), 0
    for record in records:
        require(isinstance(record, dict) and set(record) == {"id", "section", "facts"}, "record requires id, section and facts")
        require(isinstance(record["id"], str) and re.fullmatch(r"[a-z0-9][a-z0-9-]*", record["id"]) and record["id"] not in identifiers, "record IDs must be unique stable lowercase slugs")
        identifiers.add(record["id"])
        require(isinstance(record["section"], str) and record["section"] in FIELDS, "unsupported profile section")
        identities += record["section"] == "identity"
        require(identities <= 1, "a candidate profile can contain only one identity record")
        require(isinstance(record["facts"], dict) and bool(record["facts"]) and not set(record["facts"]) - set(FIELDS[record["section"]]), "record contains unsupported or empty facts")
        for fact in record["facts"].values():
            validate_fact(fact, sources, patch)


def validate_profile(profile):
    require(isinstance(profile, dict) and set(profile) == {"schema_version", "sources", "records", "issues", "conflicts"}, "invalid profile fields")
    require(type(profile["schema_version"]) is int and profile["schema_version"] == 1, "profile schema_version must be 1")
    require(isinstance(profile["sources"], dict), "profile.sources must be an object")
    for key, source in profile["sources"].items():
        validate_source(source)
        require(key == source["id"], "source registry key contradicts its ID")
    validate_records(profile["records"], profile["sources"])
    string_list(profile["issues"], "profile.issues")
    require(isinstance(profile["conflicts"], list), "conflicts must be a list")
    records = {r["id"]: r for r in profile["records"]}
    conflict_ids = set()
    for conflict in profile["conflicts"]:
        require(isinstance(conflict, dict) and set(conflict) == {"id", "record_id", "field", "existing", "incoming"}, "invalid conflict")
        require(isinstance(conflict["id"], str) and conflict["id"] not in conflict_ids, "conflict IDs must be unique")
        conflict_ids.add(conflict["id"])
        require(isinstance(conflict["record_id"], str) and isinstance(conflict["field"], str) and conflict["record_id"] in records and conflict["field"] in records[conflict["record_id"]]["facts"], "conflict references an unknown fact")
        validate_fact(conflict["existing"], profile["sources"])
        validate_fact(conflict["incoming"], profile["sources"])
    return profile


def equal(a, b):
    return comparable(a) == comparable(b)


def comparable(value):
    if isinstance(value, str):
        return normalized(value)
    if isinstance(value, list):
        return sorted({normalized(x) for x in value})
    return value


def combined_evidence(a, b):
    return sorted({encoded(e): e for e in a + b}.values(), key=lambda e: (e["source_id"], e["page"], e["quote"]))


def summary(profile):
    validate_profile(profile)
    unknowns = []
    known = False
    if not any(r["section"] == "identity" for r in profile["records"]):
        unknowns.append({"record_id": None, "field": "full_name"})
    for record in profile["records"]:
        for field in set(EXPECTED[record["section"]]) | set(record["facts"]):
            if record["facts"].get(field, {}).get("value") is None:
                unknowns.append({"record_id": record["id"], "field": field})
        known |= any(f["value"] is not None for f in record["facts"].values())
    unknowns.sort(key=lambda x: (x["record_id"] or "", x["field"]))
    outcome = "needs_clarification" if not known else "partial" if unknowns or profile["conflicts"] or profile["issues"] else "ready"
    return {"schema_version": 1, "outcome": outcome, "revision": digest(profile), "profile": deepcopy(profile),
            "unknowns": unknowns, "conflicts": deepcopy(profile["conflicts"]), "issues": list(profile["issues"])}


def plan(existing, changes):
    require(isinstance(changes, dict) and {"schema_version", "sources", "records"} <= set(changes) and not set(changes) - {"schema_version", "sources", "records", "issues", "resolved_issues"}, "changes require schema_version, sources and records")
    require(type(changes["schema_version"]) is int and changes["schema_version"] == 1, "changes schema_version must be 1")
    profile = deepcopy(existing) if existing is not None else empty_profile()
    validate_profile(profile)
    require(isinstance(changes["sources"], list), "changes.sources must be a list of extracted source objects")
    for source in changes["sources"]:
        validate_source(source)
        prior = profile["sources"].get(source["id"])
        if prior:
            require({k: v for k, v in prior.items() if k not in {"name", "path"}} == {k: v for k, v in source.items() if k not in {"name", "path"}}, "source content changed under an existing digest")
        else:
            profile["sources"][source["id"]] = deepcopy(source)
            profile["issues"].extend(f"{source['id']}: {issue}" for issue in source["issues"])
    validate_records(changes["records"], profile["sources"], patch=True)
    existing_records = {r["id"]: r for r in profile["records"]}
    for incoming in changes["records"]:
        target = existing_records.get(incoming["id"])
        if target is None:
            require(incoming["section"] != "identity" or not any(r["section"] == "identity" for r in profile["records"]), "reuse the existing identity record ID")
            target = {"id": incoming["id"], "section": incoming["section"], "facts": {}}
            profile["records"].append(target)
            existing_records[target["id"]] = target
        require(target["section"] == incoming["section"], "an existing record's section cannot change during import")
        for field, proposed in incoming["facts"].items():
            fact = deepcopy(proposed)
            correction = fact.pop("correction", False)
            fact["evidence"] = combined_evidence([], fact["evidence"])
            if isinstance(fact["value"], list):
                unique = {}
                for item in fact["value"]:
                    unique.setdefault(normalized(item), item)
                fact["value"] = list(unique.values())
            if correction:
                fact["user_corrected"] = True
            current = target["facts"].get(field)
            if correction:
                target["facts"][field] = fact
                profile["conflicts"] = [c for c in profile["conflicts"] if (c["record_id"], c["field"]) != (target["id"], field)]
            elif current is None or (current["value"] is None and not current.get("user_corrected")):
                target["facts"][field] = fact
            elif fact["value"] is None:
                continue
            elif equal(current["value"], fact["value"]):
                current["evidence"] = combined_evidence(current["evidence"], fact["evidence"])
            elif isinstance(current["value"], list) and isinstance(fact["value"], list) and not current.get("user_corrected"):
                seen = {normalized(x) for x in current["value"]}
                for item in fact["value"]:
                    if normalized(item) not in seen:
                        current["value"].append(item)
                        seen.add(normalized(item))
                current["evidence"] = combined_evidence(current["evidence"], fact["evidence"])
            else:
                identifier = digest([target["id"], field, comparable(fact["value"])])
                prior = next((c for c in profile["conflicts"] if c["id"] == identifier), None)
                if prior:
                    prior["incoming"]["evidence"] = combined_evidence(prior["incoming"]["evidence"], fact["evidence"])
                else:
                    profile["conflicts"].append({"id": identifier, "record_id": target["id"], "field": field, "existing": deepcopy(current), "incoming": fact})
    additions = string_list(changes.get("issues", []), "changes.issues")
    resolved = string_list(changes.get("resolved_issues", []), "changes.resolved_issues")
    if resolved:
        require(any(source["kind"] == "user" for source in changes["sources"]), "resolving issues requires explicit user statements")
        require(set(resolved) <= set(profile["issues"]), "resolved_issues contains unknown issues")
    profile["issues"] = sorted((set(profile["issues"]) | set(additions)) - set(resolved))
    profile["records"].sort(key=lambda r: (list(FIELDS).index(r["section"]), r["id"]))
    profile["conflicts"].sort(key=lambda c: c["id"])
    result = summary(profile)
    result["base_revision"] = digest(existing) if existing is not None else None
    return result


def escaped(value):
    return re.sub(r"([\\`*_\[\]#|])", r"\\\1", html.escape(value, quote=False)).replace("\n", " ")


def heading(record):
    values = {key: fact["value"] for key, fact in record["facts"].items()}
    fields = {"identity": ["full_name"], "experience": ["role", "company"],
              "education": ["qualification", "institution"]}.get(record["section"], ["name"])
    parts = ["; ".join(values[key]) if isinstance(values.get(key), list) else values[key]
             for key in fields if values.get(key) is not None]
    return " — ".join(parts) or record["id"]


def chronology(record):
    def date_value(key):
        value = record["facts"].get(key, {}).get("value")
        if value == "present":
            return (9999, 12, 31)
        if isinstance(value, str) and re.fullmatch(r"\d{4}(?:-\d{2})?(?:-\d{2})?", value):
            parts = [int(part) for part in value.split("-")]
            return tuple(parts + [0] * (3 - len(parts)))
        return (0, 0, 0)
    return tuple(-x for x in date_value("end_date") + date_value("start_date")) + (record["id"],)


def render(profile):
    result = summary(profile)
    lines = ["# Candidate profile", "", f"Status: {result['outcome']}", "", "Generated from candidate/profile.yaml. Update the canonical profile through jsf-profile; this file is a readable view.", ""]
    disputed = {(c["record_id"], c["field"]) for c in profile["conflicts"]}
    for section, fields in FIELDS.items():
        records = [r for r in profile["records"] if r["section"] == section]
        if not records:
            continue
        lines.extend([f"## {section.replace('_', ' ').title()}", ""])
        if section in {"experience", "education"}:
            records.sort(key=chronology)
        for record in records:
            lines.extend([f"### {escaped(heading(record))}", ""])
            for field in fields:
                fact = record["facts"].get(field)
                if fact is None and field not in EXPECTED[section]:
                    continue
                value = fact["value"] if fact else None
                display = "Unknown" if value is None else "; ".join(escaped(x) for x in value) if isinstance(value, list) else escaped(value)
                flag = " — needs clarification (conflicting evidence)" if (record["id"], field) in disputed else ""
                lines.append(f"- **{field.replace('_', ' ').title()}:** {display}{flag}")
                if fact:
                    for evidence in fact["evidence"]:
                        source = profile["sources"][evidence["source_id"]]
                        lines.append(f"  - Source: {escaped(source['name'])}, page {evidence['page']}: “{escaped(evidence['quote'])}”")
            lines.append("")
    if result["conflicts"] or result["issues"]:
        lines.extend(["## Needs clarification", ""])
        for conflict in result["conflicts"]:
            lines.append(f"- {conflict['record_id']}/{conflict['field']}: incoming value {escaped(str(conflict['incoming']['value']))}; existing value retained pending resolution.")
        lines.extend(f"- {escaped(issue)}" for issue in result["issues"])
        lines.append("")
    return "\n".join(lines)


def yaml_module():
    try:
        import yaml
        return yaml
    except ImportError:
        raise ValidationError("YAML support needs PyYAML; install scripts/requirements.txt in your Python environment") from None


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValidationError(f"cannot read JSON: {exc}") from None


def read_yaml(path):
    yaml = yaml_module()
    class StrictLoader(yaml.SafeLoader):
        pass
    def mapping(loader, node):
        loader.flatten_mapping(node)
        result = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node)
            require(isinstance(key, str) and key not in result, "YAML mapping keys must be unique strings")
            result[key] = loader.construct_object(value_node)
        return result
    StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    try:
        profile = yaml.load(path.read_text(encoding="utf-8"), Loader=StrictLoader)
    except (OSError, yaml.YAMLError) as exc:
        raise ValidationError(f"cannot read YAML: {exc}") from None
    return profile


def load(workspace):
    path = Path(workspace) / "candidate" / "profile.yaml"
    return validate_profile(read_yaml(path)) if path.exists() else None


def export(workspace):
    profile = load(workspace)
    require(profile is not None, 'workspace has no candidate/profile.yaml')
    return summary(profile)


def expertise(workspace):
    """Validated current professional context; no search preferences are inferred."""
    profile = export(workspace)['profile']
    return [record for record in profile['records'] if record['section'] in {'skills', 'experience', 'projects', 'languages'}]


def atomic_write(path, content):
    if path.exists() and path.read_text(encoding='utf-8') == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ensure_preserved(current, proposed):
    if current is None:
        return
    for key, source in current["sources"].items():
        require(proposed["sources"].get(key) == source, "an update cannot remove or rewrite source history")
    records = {r["id"]: r for r in proposed["records"]}
    for old in current["records"]:
        new = records.get(old["id"])
        require(new is not None and new["section"] == old["section"], "an update cannot remove existing records")
        for key, fact in old["facts"].items():
            target = new["facts"].get(key)
            require(target is not None, "an update cannot omit an existing fact")
            if target.get("user_corrected"):
                continue
            require(not fact.get("user_corrected"), "an update cannot remove explicit correction provenance")
            if fact["value"] is None or equal(fact["value"], target["value"]):
                continue
            require(isinstance(fact["value"], list) and isinstance(target["value"], list) and {normalized(x) for x in fact["value"]} <= {normalized(x) for x in target["value"]}, "a changed fact requires an explicit user correction")


def protect_sources(workspace, sources):
    targets = {(Path(workspace) / "candidate" / name).resolve() for name in ("profile.yaml", "profile.json", "README.md")}
    targets.add((Path(workspace) / "search-config.yml").resolve())
    for source in sources:
        if source.get("path"):
            require(Path(source["path"]).resolve() not in targets, "source CV overlaps an output artifact; move/copy it to a separate source path first")


def persist(workspace, profile, canonical=True):
    result = summary(profile)
    require(result["outcome"] != "needs_clarification", "no supported facts extracted; resolve the source before saving a profile")
    protect_sources(workspace, profile["sources"].values())
    markdown = render(profile)
    yaml_text = yaml_module().safe_dump(profile, allow_unicode=True, sort_keys=False) if canonical else None
    directory = Path(workspace) / "candidate"
    if canonical and load(workspace) != profile:
        atomic_write(directory / "profile.yaml", yaml_text)
    atomic_write(directory / "README.md", markdown)
    # Remove the formerly generated cache only on an explicit write operation.
    (directory / "profile.json").unlink(missing_ok=True)
    return result


def apply_plan(workspace, proposal):
    require(isinstance(proposal, dict) and "base_revision" in proposal and "profile" in proposal, "apply requires a plan result")
    current = load(workspace)
    actual_revision = digest(current) if current is not None else None
    require(actual_revision == proposal["base_revision"], "profile changed since planning; re-plan against the current YAML")
    proposed = validate_profile(proposal["profile"])
    require(proposal.get("revision") == digest(proposed), "plan contents changed; regenerate the plan instead of editing its result")
    ensure_preserved(current, proposed)
    return persist(workspace, proposed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    extraction = commands.add_parser("extract")
    extraction.add_argument("--source", required=True)
    extraction.add_argument("--kind", choices=["cv", "user"], default="cv")
    planning = commands.add_parser("plan")
    planning.add_argument("--changes", required=True)
    planning.add_argument("--workspace", required=True)
    applying = commands.add_parser("apply")
    applying.add_argument("--plan", required=True)
    applying.add_argument("--workspace", required=True)
    for name in ("export", "render"):
        command = commands.add_parser(name)
        command.add_argument("--workspace", required=True)
    for name in ('init-search', 'validate-search', 'export-search'):
        command = commands.add_parser(name)
        command.add_argument('--workspace', required=True)
        if name == 'init-search':
            command.add_argument('--country')
            command.add_argument('--city')
    args = parser.parse_args()
    try:
        if hasattr(args, "workspace"):
            string(args.workspace, "workspace")
        if args.command == "extract":
            result = extract(args.source, args.kind)
        elif args.command == "plan":
            changes = read_json(args.changes)
            result = plan(load(args.workspace), changes)
            protect_sources(args.workspace, changes["sources"])
        elif args.command == "apply":
            result = apply_plan(args.workspace, read_json(args.plan))
        elif args.command in {'init-search', 'validate-search', 'export-search'}:
            from .search_config import initialize, inspect_config, export
            if args.command == 'init-search':
                result = initialize(args.workspace, args.country, args.city)
            elif args.command == 'validate-search':
                result = inspect_config(args.workspace)
            else:
                result = export(args.workspace)
        else:
            profile = load(args.workspace)
            require(profile is not None, "workspace has no candidate/profile.yaml")
            result = summary(profile) if args.command == "export" else persist(args.workspace, profile, canonical=False)
        sys.stdout.write(encoded(result))
        return 0
    except (ValidationError, OSError, ValueError, TypeError, RecursionError) as exc:
        sys.stderr.write(f"jsf-profile: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

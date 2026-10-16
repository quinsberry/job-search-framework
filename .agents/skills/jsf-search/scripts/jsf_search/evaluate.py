"""Pure evaluation of explicit search criteria and evidence-backed vacancy facts."""

from copy import deepcopy
from datetime import datetime, date, timezone
from decimal import Decimal, InvalidOperation
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


class ValidationError(ValueError):
    pass


def text(value):
    return " ".join(str(value).casefold().split())


def strings(value, name, nullable=False):
    if nullable and value is None:
        return None
    if not isinstance(value, list) or any(not isinstance(x, str) or not x.strip() for x in value):
        raise ValidationError(f"{name} must be a list of nonempty strings")
    return list(dict.fromkeys(text(x) for x in value))


def number(value, name):
    try:
        if isinstance(value, bool):
            raise InvalidOperation
        result = Decimal(str(value))
        if not result.is_finite() or result <= 0:
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise ValidationError(f"{name} must be a finite positive number") from None


def timestamp(value, name):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        raise ValidationError(f"{name} must be an ISO timestamp with timezone") from None


def pay(row, minimum=False):
    if not isinstance(row, dict):
        raise ValidationError("compensation entries must be objects")
    result = deepcopy(row)
    for key in ("contract", "currency", "period", "basis"):
        if not isinstance(row.get(key), str):
            raise ValidationError(f"compensation.{key} is required")
        result[key] = text(row[key])
    if result["contract"] not in {"b2b", "uop"}:
        raise ValidationError("contract must be b2b or uop")
    if result["currency"] not in {"eur", "pln", "usd"}:
        raise ValidationError("currency must be EUR, PLN or USD")
    if result["period"] not in {"month", "year", "hour"}:
        raise ValidationError("period must be month, year or hour")
    if result["basis"] != {"b2b": "before_vat", "uop": "gross"}[result["contract"]]:
        raise ValidationError("use before_vat for B2B and gross for UoP; do not convert taxes")
    if minimum:
        result["minimum"] = str(number(row.get("minimum"), "minimum"))
    else:
        for key in ("low", "high"):
            result[key] = str(number(row.get(key), key))
        if Decimal(result["low"]) > Decimal(result["high"]):
            raise ValidationError("advertised compensation low exceeds high")
    return result


def criteria(data):
    if not isinstance(data, dict):
        raise ValidationError("criteria must be an object")
    allowed = {"sources", "titles", "target_count", "candidate", "seniorities", "compensation",
               "technical", "work_arrangements", "office_locations", "vacancy_types",
               "company_exclusions", "preferences", "posting_age_days", "discovery_budget", "conversions"}
    if set(data) - allowed:
        raise ValidationError(f"unknown criteria fields: {sorted(set(data) - allowed)}")
    c = deepcopy(data)
    for key in ("sources", "titles"):
        c[key] = strings(c.get(key), key)
        if not c[key]:
            raise ValidationError(f"{key} must not be empty")
    if type(c.get("target_count")) is not int or c["target_count"] < 1:
        raise ValidationError("target_count must be a positive integer")
    c.setdefault("discovery_budget", c["target_count"] * 10)
    if type(c["discovery_budget"]) is not int or c["discovery_budget"] < c["target_count"]:
        raise ValidationError("discovery_budget must be an integer at least target_count")
    candidate = c.get("candidate")
    if not isinstance(candidate, dict) or not isinstance(candidate.get("country"), str) or not candidate["country"].strip():
        raise ValidationError("candidate.country is required")
    if set(candidate) - {"country", "city", "work_authorization"}:
        raise ValidationError("candidate supports country, city and work_authorization")
    candidate["country"] = text(candidate["country"])
    if candidate.get("city") is not None:
        if not isinstance(candidate["city"], str) or not candidate["city"].strip():
            raise ValidationError("candidate.city must be a nonempty string or null")
        candidate["city"] = text(candidate["city"])
    candidate["work_authorization"] = strings(candidate.get("work_authorization"), "work_authorization", True)
    for key in ("seniorities", "work_arrangements"):
        if key not in c:
            raise ValidationError(f"{key} is required; use null for no restriction")
        c[key] = strings(c[key], key, True)
        if c[key] == []:
            raise ValidationError(f"{key} must be nonempty or null")
    if c["work_arrangements"] is not None and set(c["work_arrangements"]) - {"onsite", "remote", "hybrid"}:
        raise ValidationError("work_arrangements supports onsite, remote and hybrid")
    c["office_locations"] = strings(c.get("office_locations"), "office_locations", True)
    if c["office_locations"] == []:
        raise ValidationError("office_locations must be nonempty or null")
    if "compensation" not in c:
        raise ValidationError("compensation is required; use null for no restriction")
    if c["compensation"] is not None:
        if not isinstance(c["compensation"], list) or not c["compensation"]:
            raise ValidationError("compensation must be a nonempty list or null")
        c["compensation"] = [pay(row, True) for row in c["compensation"]]
        contracts = [row["contract"] for row in c["compensation"]]
        if len(set(contracts)) != len(contracts):
            raise ValidationError("specify one minimum per contract type")
    tech = c.get("technical")
    if not isinstance(tech, dict) or set(tech) != {"required", "preferred", "excluded"}:
        raise ValidationError("technical requires required, preferred and excluded lists; empty lists mean no restriction")
    for key in tech:
        tech[key] = strings(tech[key], f"technical.{key}")
    if (set(tech["required"]) | set(tech["preferred"])) & set(tech["excluded"]):
        raise ValidationError("a technical criterion cannot be both wanted and excluded")
    vt = c.setdefault("vacancy_types", {"required": None, "preferred": [], "excluded": []})
    if not isinstance(vt, dict) or set(vt) != {"required", "preferred", "excluded"}:
        raise ValidationError("vacancy_types requires required, preferred and excluded")
    for key in vt:
        vt[key] = strings(vt[key], f"vacancy_types.{key}", key == "required")
        if vt[key] is not None and set(vt[key]) - {"product", "outsource", "outstaff"}:
            raise ValidationError("vacancy types are product, outsource or outstaff")
    if vt["required"] == [] or (vt["required"] is not None and set(vt["required"]) <= set(vt["excluded"])):
        raise ValidationError("vacancy_types has no permitted required option")
    if set(vt["preferred"]) & set(vt["excluded"]):
        raise ValidationError("a vacancy type cannot be preferred and excluded")
    c["company_exclusions"] = strings(c.get("company_exclusions", []), "company_exclusions")
    defaults = tech["preferred"] + [f"vacancy_type:{x}" for x in vt["preferred"]]
    c["preferences"] = strings(c.get("preferences", defaults), "preferences")
    age = c.setdefault("posting_age_days", None)
    if age is not None and (type(age) is not int or age < 1):
        raise ValidationError("posting_age_days must be a positive integer or null")
    conv = c.setdefault("conversions", {})
    if not isinstance(conv, dict) or set(conv) - {"hours_per_month", "fx"}:
        raise ValidationError("conversions supports hours_per_month and fx")
    if "hours_per_month" in conv:
        conv["hours_per_month"] = str(number(conv["hours_per_month"], "hours_per_month"))
    if "fx" in conv:
        fx = conv["fx"]
        if not isinstance(fx, dict) or not isinstance(fx.get("source"), str) or not fx["source"].strip():
            raise ValidationError("fx.source is required")
        try:
            date.fromisoformat(fx["date"])
        except (KeyError, TypeError, ValueError):
            raise ValidationError("fx.date must be YYYY-MM-DD") from None
        if text(fx.get("base", "")) not in {"eur", "pln", "usd"} or not isinstance(fx.get("rates"), dict):
            raise ValidationError("fx needs base and rates (units of each currency per one base unit)")
        fx["base"] = text(fx["base"])
        fx["rates"] = {text(k): str(number(v, "FX rate")) for k, v in fx["rates"].items()}
        if set(fx["rates"]) - {"eur", "pln", "usd"}:
            raise ValidationError("unsupported FX currency")
        if Decimal(fx["rates"].get(fx["base"], "1")) != 1:
            raise ValidationError("FX base rate must equal 1")
        fx["rates"][fx["base"]] = "1"
    return c


def canonical_url(url):
    if not isinstance(url, str):
        raise ValidationError("vacancy URL must be a string")
    try:
        u = urlsplit(url)
    except ValueError:
        raise ValidationError("invalid vacancy URL") from None
    if u.scheme not in {"http", "https"} or not u.hostname or u.username or u.password:
        raise ValidationError("vacancy URL must be an HTTP(S) URL without credentials")
    host = u.hostname.casefold()
    if host == "linkedin.com" or host.endswith(".linkedin.com"):
        match = re.search(r"(?:/jobs/view/(?:[^/?]*-)?|/jobs-guest/jobs/api/jobPosting/)(\d+)(?:/|$)", u.path)
        if match:
            return f"https://www.linkedin.com/jobs/view/{match[1]}"
    # Application query parameters may identify distinct requisitions: only remove tracking.
    query = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
             if not k.casefold().startswith("utm_") and k.casefold() not in {"trk", "trackingid", "refid"}]
    return urlunsplit((u.scheme.casefold(), u.netloc.casefold(), u.path.rstrip("/"), urlencode(sorted(query)), ""))


def identities(v):
    url = canonical_url(v["url"])
    source_id = str(v.get("source_id") or "").strip()
    if v["source"] == "linkedin":
        match = re.search(r"/jobs/view/(\d+)$", url)
        if match:
            if source_id and source_id != match[1]:
                raise ValidationError("LinkedIn source_id contradicts its URL")
            source_id = match[1]
    primary = f"{v['source']}:{source_id}" if source_id else f"{v['source']}:{url}"
    keys = {primary, f"url:{url}"}
    if v.get("application_url"):
        keys.add(f"apply:{canonical_url(v['application_url'])}")
    if v.get("employer_id") and v.get("requisition_id"):
        keys.add(f"requisition:{text(v['employer_id'])}:{v['requisition_id']}")
    return primary, keys


def evidence(v, entries):
    if not isinstance(entries, list) or not entries:
        return False
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("field") not in {"title", "company", "location", "description", "seniority_label", "employment_type"}:
            raise ValidationError("evidence needs a supported raw field and a quote")
        quote = entry.get("quote")
        if not isinstance(quote, str) or not quote.strip() or text(quote) not in text(v.get(entry["field"], "")):
            raise ValidationError("evidence quote does not occur in its raw vacancy field")
    return True


def observation(v, key, group=None):
    facts = v.get("facts", {})
    container = facts.get(group, {}) if group else facts
    if not isinstance(container, dict):
        raise ValidationError(f"facts.{group or key} must be an object")
    obs = container.get(key)
    if obs is None:
        return None
    if not isinstance(obs, dict) or "value" not in obs:
        raise ValidationError(f"facts.{key} must contain value and evidence")
    if obs["value"] is None:
        return None
    if not evidence(v, obs.get("evidence")):
        return None
    return obs["value"]


def option(v, key, accepted):
    value = observation(v, key)
    if value is None:
        return "unknown"
    values = strings(value if isinstance(value, list) else [value], f"facts.{key}")
    return "pass" if set(values) & set(accepted) else "fail"


def boolean(v, key, group):
    value = observation(v, key, group)
    if value is not None and type(value) is not bool:
        raise ValidationError(f"facts.{group}.{key}.value must be true, false or null")
    return value


def monthly(amount, period, conversions):
    amount = Decimal(amount)
    if period == "year":
        return amount / 12
    if period == "hour":
        hours = conversions.get("hours_per_month")
        return amount * Decimal(hours) if hours else None
    return amount


def advertised_bands(v):
    rows = v.get("facts", {}).get("compensation", [])
    if not isinstance(rows, list):
        raise ValidationError("facts.compensation must be a list")
    valid = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValidationError("advertised compensation must be an object")
        if evidence(v, row.get("evidence")):
            valid.append(pay(row))
    return valid


def compensation(v, c):
    valid = advertised_bands(v)
    offered = observation(v, "contract_types")
    if offered is not None:
        offered = strings(offered, "facts.contract_types")
    decisions, comparisons = [], []
    for req in c["compensation"]:
        if offered is not None and req["contract"] not in offered:
            continue
        matching = [row for row in valid if row["contract"] == req["contract"]]
        if not matching:
            decisions.append("unknown")
        for row in matching:
            low, high, floor = Decimal(row["low"]), Decimal(row["high"]), Decimal(req["minimum"])
            if row["period"] != req["period"]:
                low = monthly(str(low), row["period"], c["conversions"])
                high = monthly(str(high), row["period"], c["conversions"])
                floor = monthly(str(floor), req["period"], c["conversions"])
            if row["currency"] != req["currency"]:
                rates = c["conversions"].get("fx", {}).get("rates", {})
                if row["currency"] not in rates or req["currency"] not in rates:
                    low = high = None
                elif high is not None:
                    factor = Decimal(rates[req["currency"]]) / Decimal(rates[row["currency"]])
                    low, high = low * factor, high * factor
            status = "unknown" if high is None or floor is None else ("pass" if high >= floor else "fail")
            decisions.append(status)
            comparisons.append({"contract": req["contract"], "status": status,
                                "lower_end_below_minimum": low < floor if low is not None and floor is not None else None,
                                "advertised": row})
    status = "pass" if "pass" in decisions else "unknown" if "unknown" in decisions else "fail"
    return status, comparisons


def assess(v, c, observed_at):
    checks, warnings = [], []
    def check(name, status, reason):
        checks.append({"criterion": name, "status": status, "reason": reason})

    check("description", "pass" if v.get("fetch_status", "ok") == "ok" and (v.get("description") or "").strip() else "unknown", "An accessible full description is required")
    if v.get("fetch_status") == "not_found":
        check("availability", "unknown", "Posting URL unavailable (HTTP 404); closure is unconfirmed")
        warnings.append("Activity is unconfirmed")
    elif v.get("active") is False:
        check("activity", "fail", "Posting is confirmed closed")
    elif v.get("active") is True:
        check("activity", "pass", "Posting is confirmed active")
    elif v.get("active") is not True:
        warnings.append("Activity is unconfirmed")
    check("role_scope", option(v, "role_titles", c["titles"]), "Match described role scope, not just the advertised title")
    if c["seniorities"] is not None:
        check("seniority", option(v, "seniority", c["seniorities"]), "Use described responsibilities and level")
    arrangements = observation(v, "work_arrangements")
    if arrangements is not None:
        arrangements = strings(arrangements, "facts.work_arrangements")
        if not arrangements or set(arrangements) - {"remote", "hybrid", "onsite"}:
            raise ValidationError("invalid vacancy work arrangements")
    if c["work_arrangements"] is not None:
        check("work_arrangements", option(v, "work_arrangements", c["work_arrangements"]), "At least one accepted arrangement is required")
    countries = observation(v, "eligible_countries")
    if countries is not None:
        countries = strings(countries, "facts.eligible_countries")
    check("country_eligibility", "unknown" if countries is None else "pass" if "*" in countries or c["candidate"]["country"] in countries else "fail", "Remote work can have country restrictions")
    allowed_arrangements = set(arrangements or []) & set(c["work_arrangements"] or ["remote", "hybrid", "onsite"])
    if c["office_locations"] is not None and "remote" not in allowed_arrangements:
        check("office_location", option(v, "office_locations", c["office_locations"]) if arrangements else "unknown", "Onsite and hybrid offices must be acceptable")
    authorization = c["candidate"]["work_authorization"]
    if authorization is not None:
        required = observation(v, "authorization_requirements")
        if required is not None:
            required = strings(required, "facts.authorization_requirements")
        check("work_authorization", "unknown" if required is None else "pass" if set(required) <= set(authorization) else "fail", "Check explicit employer authorization requirements")
    if c["company_exclusions"]:
        company = v.get("company")
        check("company_exclusions", "unknown" if not company else "fail" if text(company) in c["company_exclusions"] else "pass", "Exact normalized company exclusion")
    vt = c["vacancy_types"]
    if vt["required"] is not None:
        check("vacancy_type", option(v, "vacancy_type", vt["required"]), "At least one permitted vacancy type is required")
    if vt["excluded"]:
        value = observation(v, "vacancy_type")
        if value is not None and text(value) in vt["excluded"]:
            check("vacancy_type_exclusion", "fail", "Confirmed excluded vacancy type")
    for criterion in c["technical"]["required"]:
        value = boolean(v, criterion, "technical")
        check(f"technical:{criterion}", "unknown" if value is None else "pass" if value else "fail", "Requires contextual description evidence; optional mentions alone do not satisfy a mandatory criterion")
    for criterion in c["technical"]["excluded"]:
        if boolean(v, criterion, "technical") is True:
            check(f"excluded:{criterion}", "fail", "Confirmed technical exclusion")
    comparisons = []
    if c["compensation"] is not None:
        status, comparisons = compensation(v, c)
        check("compensation", status, "At least one acceptable contract's advertised maximum must reach its minimum")
    if c["posting_age_days"] is not None:
        try:
            posted = date.fromisoformat(v.get("posted_at", "")[:10])
            age = (observed_at.date() - posted).days
            status = "unknown" if age < 0 else "pass" if age <= c["posting_age_days"] else "fail"
        except (TypeError, ValueError):
            status = "unknown"
        check("posting_age", status, "Age uses the snapshot's observation time")
    preferences = []
    for name in c["preferences"]:
        if name in c["technical"]["preferred"]:
            satisfied = boolean(v, name, "technical") is True
        elif name.startswith("vacancy_type:"):
            value = observation(v, "vacancy_type")
            satisfied = value is not None and text(value) == name.split(":", 1)[1]
        else:
            satisfied = boolean(v, name, "preferences") is True
        preferences.append({"criterion": name, "satisfied": satisfied})
    status = "rejected" if any(x["status"] == "fail" for x in checks) else "needs_clarification" if any(x["status"] == "unknown" for x in checks) else "match"
    primary, _ = identities(v)
    return {"vacancy_id": primary, "source": v["source"], "source_id": v.get("source_id"),
            "url": canonical_url(v["url"]), "title": v.get("title"), "company": v.get("company"),
            "location": v.get("location"), "posted_at": v.get("posted_at"), "facts": deepcopy(v.get("facts", {})),
            "status": status, "checks": checks, "warnings": warnings,
            "advertised_compensation": advertised_bands(v),
            "compensation_comparisons": comparisons, "preferences": preferences}


def evaluate(data, snapshot):
    c = criteria(data)
    s = deepcopy(snapshot)
    if not isinstance(s, dict) or type(s.get("schema_version")) is not int or s["schema_version"] != 1 or not isinstance(s.get("vacancies"), list):
        raise ValidationError("snapshot needs schema_version 1 and a vacancies list")
    observed = timestamp(s.get("observed_at"), "snapshot.observed_at")
    if not isinstance(s.get("coverage", {}), dict):
        raise ValidationError("snapshot.coverage must be an object")
    if not isinstance(s.get("coverage", {}).get("errors", []), list):
        raise ValidationError("coverage.errors must be a list")
    skipped = s.get("coverage", {}).get("duplicates_skipped", 0)
    if type(skipped) is not int or skipped < 0:
        raise ValidationError("coverage.duplicates_skipped must be a nonnegative integer")
    if s.get("interpreted_for") is not None and criteria(s["interpreted_for"]) != c:
        raise ValidationError("snapshot interpretation used different criteria; explicitly reinterpret its facts first")
    groups = []
    for v in s["vacancies"]:
        if not isinstance(v, dict) or v.get("source") not in c["sources"]:
            raise ValidationError("each vacancy must belong to a requested source")
        if not isinstance(v.get("facts", {}), dict):
            raise ValidationError("vacancy facts must be an object")
        if not isinstance(v.get("url"), str):
            raise ValidationError("vacancy.url is required")
        for field in ("title", "company", "location", "description", "posted_at", "seniority_label", "employment_type"):
            if v.get(field) is not None and not isinstance(v[field], str):
                raise ValidationError(f"vacancy.{field} must be a string or null")
        if v.get("active") is not None and type(v["active"]) is not bool:
            raise ValidationError("vacancy.active must be true, false or null")
        primary, keys = identities(v)
        touching = [group for group in groups if group["keys"] & keys]
        group = {"keys": set(keys), "members": [v]}
        for other in touching:
            group["keys"].update(other["keys"])
            group["members"].extend(other["members"])
            groups.remove(other)
        groups.append(group)
    results = []
    for group in groups:
        members = sorted(group["members"], key=lambda v: identities(v)[0])
        assessed = [assess(v, c, observed) for v in members]
        # Prefer complete evidence, but never silently accept conflicting duplicate assessments.
        result = deepcopy(min(assessed, key=lambda r: (sum(x["status"] == "unknown" for x in r["checks"]), r["vacancy_id"])))
        by_criterion = {}
        for row in assessed:
            for check in row["checks"]:
                by_criterion.setdefault(check["criterion"], set()).add(check["status"])
        conflicts = [name for name, states in by_criterion.items() if {"pass", "fail"} <= states]
        merged_checks = []
        for name, states in sorted(by_criterion.items()):
            status = "unknown" if name in conflicts else "fail" if "fail" in states else "pass" if "pass" in states else "unknown"
            candidates = [x for row in assessed for x in row["checks"] if x["criterion"] == name]
            chosen = deepcopy(next((x for x in candidates if x["status"] == status), candidates[0]))
            chosen["status"] = status
            merged_checks.append(chosen)
        result["checks"] = merged_checks
        if conflicts:
            result["checks"].append({"criterion": "duplicate_evidence", "status": "unknown", "reason": f"Conflicting source evidence: {', '.join(sorted(conflicts))}"})
        result["status"] = "rejected" if any(x["status"] == "fail" for x in result["checks"]) else "needs_clarification" if any(x["status"] == "unknown" for x in result["checks"]) else "match"
        result["vacancy_id"] = min(identities(v)[0] for v in members)
        result["provenance"] = [{"source": v["source"], "source_id": v.get("source_id"), "url": canonical_url(v["url"])} for v in members]
        result["aliases"] = sorted(group["keys"])
        if len(members) > 1:
            result["source_assessments"] = [{"vacancy_id": row["vacancy_id"], "checks": row["checks"], "facts": row["facts"]} for row in assessed]
        results.append(result)
    def rank(row):
        try:
            posted = date.fromisoformat((row.get("posted_at") or "")[:10]).toordinal()
        except ValueError:
            posted = 0
        return tuple(not x["satisfied"] for x in row["preferences"]) + (-posted, row["vacancy_id"])
    matches = sorted((r for r in results if r["status"] == "match"), key=rank)
    unclear = sorted((r for r in results if r["status"] == "needs_clarification"), key=rank)
    rejected = sorted((r for r in results if r["status"] == "rejected"), key=lambda r: r["vacancy_id"])
    coverage = deepcopy(s.get("coverage", {}))
    complete = len(matches) >= c["target_count"]
    usable = any(v.get("fetch_status", "ok") == "ok" and v.get("description") for v in s["vacancies"])
    outcome = "target_met" if complete else "failed" if coverage.get("errors") and not usable else "partial"
    coverage.update({"inspected_count": len(groups), "qualifying_count": len(matches),
                     "returned_count": min(len(matches), c["target_count"]), "clarification_count": len(unclear),
                     "rejected_count": len(rejected), "duplicates_skipped": coverage.get("duplicates_skipped", 0) + len(s["vacancies"]) - len(groups),
                     "stopping_reason": "target_met" if complete else coverage.get("stopping_reason", "snapshot_complete"),
                     "shortfall": max(0, c["target_count"] - len(matches))})
    return {"schema_version": 1, "outcome": outcome, "criteria": c, "matches": matches[:c["target_count"]],
            "needs_clarification": unclear, "rejected": rejected, "assessments": matches + unclear + rejected,
            "coverage": coverage, "snapshot": s}


def report(result):
    lines = [f"# Vacancy shortlist — {result['outcome']}", "", f"Found {result['coverage']['returned_count']} of {result['criteria']['target_count']} requested matches.", ""]
    for heading, key in (("Matches", "matches"), ("Needs clarification", "needs_clarification"), ("Rejected", "rejected")):
        lines += [f"## {heading}", ""]
        for row in result[key]:
            label = f"{row.get('title') or 'Unknown title'} — {row.get('company') or 'Unknown company'}"
            lines.append(f"- [{label}]({row['url']}) · `{row['vacancy_id']}` · {row.get('location') or 'Location unknown'}")
            if row["status"] == "match":
                tech = [x["criterion"].split(":", 1)[1] for x in row["checks"] if x["criterion"].startswith("technical:") and x["status"] == "pass"]
                lines.append("  - Satisfies every mandatory search criterion" + (f"; technical fit: {', '.join(tech)}" if tech else ""))
            for check in row["checks"]:
                if check["status"] != "pass":
                    lines.append(f"  - {check['criterion']}: {check['status']} — {check['reason']}")
            satisfied = [p["criterion"] for p in row["preferences"] if p["satisfied"]]
            if satisfied:
                lines.append(f"  - Preferences satisfied: {', '.join(satisfied)}")
            for advertised in row["advertised_compensation"]:
                lines.append(f"  - Advertised: {advertised['low']}–{advertised['high']} {advertised['currency'].upper()}/{advertised['period']}, {advertised['contract'].upper()}, {advertised['basis']}")
            for comparison in row["compensation_comparisons"]:
                if comparison["lower_end_below_minimum"]:
                    lines.append(f"  - {comparison['contract'].upper()} advertised lower end is below your minimum")
            lines.extend(f"  - {warning}" for warning in row["warnings"])
        if not result[key]:
            lines.append("None.")
        lines.append("")
    lines += ["## Coverage", "", f"Inspected: {result['coverage']['inspected_count']}; duplicates skipped: {result['coverage']['duplicates_skipped']}; shortfall: {result['coverage']['shortfall']}.", f"Stopped: {result['coverage']['stopping_reason']}."]
    for error in result["coverage"].get("errors", []):
        lines.append(f"- Source failure: {error}")
    return "\n".join(lines) + "\n"

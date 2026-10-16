"""Explicit acquisition checkpoints and pure snapshot evaluation CLI."""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import sys
import tempfile

from .evaluate import ValidationError, criteria, evaluate, identities, report
from .linkedin import LinkedIn


ADAPTERS = {"linkedin": LinkedIn}


def acquire(data, snapshot=None, batch_size=10, delay=2.0, adapters=None, stop_at_target=True):
    c = criteria(data)
    adapters = ADAPTERS if adapters is None else adapters
    if set(c["sources"]) - set(adapters):
        raise ValidationError(f"unsupported sources: {sorted(set(c['sources']) - set(adapters))}")
    if type(batch_size) is not int or batch_size < 1 or not math.isfinite(delay) or delay < 0:
        raise ValidationError("batch_size must be positive and delay must be finite and nonnegative")
    s = deepcopy(snapshot) if snapshot is not None else {
        "schema_version": 1, "observed_at": datetime.now(timezone.utc).isoformat(), "vacancies": [],
        "acquisition_criteria": c, "coverage": {"errors": [], "duplicates_skipped": 0, "sources": {}},
        "acquisition": {"queries": [], "next_query": 0},
    }
    # Validate the whole checkpoint before making any network request.
    existing = evaluate(c, s)
    if s.get("acquisition_criteria") != c or not isinstance(s.get("acquisition"), dict):
        raise ValidationError("resume requires an acquisition checkpoint with identical criteria")
    state = s["acquisition"]
    if not isinstance(state.get("queries"), list) or type(state.get("next_query")) is not int or state["next_query"] < 0:
        raise ValidationError("invalid acquisition query checkpoint")
    for q in state["queries"]:
        if not isinstance(q, dict) or q.get("source") not in c["sources"] or not isinstance(q.get("query"), dict):
            raise ValidationError("invalid checkpoint source query")
        if type(q.get("offset")) is not int or q["offset"] < 0 or not isinstance(q.get("pending"), list) or not isinstance(q.get("seen_pages"), list) or type(q.get("exhausted")) is not bool:
            raise ValidationError("invalid checkpoint pagination state")
        for candidate in q["pending"]:
            if not isinstance(candidate, dict) or candidate.get("source") != q["source"] or not isinstance(candidate.get("url"), str):
                raise ValidationError("invalid pending candidate")
            identities(candidate)
    coverage = s.get("coverage")
    if not isinstance(coverage, dict) or not isinstance(coverage.get("sources"), dict) or not isinstance(coverage.get("errors"), list):
        raise ValidationError("invalid checkpoint coverage")
    for name, row in coverage["sources"].items():
        if name not in c["sources"] or not isinstance(row, dict) or not isinstance(row.get("errors"), list) or any(type(row.get(key)) is not int or row[key] < 0 for key in ("pages", "candidates")):
            raise ValidationError("invalid source coverage")
    if state["queries"] and any(q["source"] not in coverage["sources"] for q in state["queries"]):
        raise ValidationError("checkpoint query lacks source coverage")
    clients = {name: adapters[name](delay=delay) for name in c["sources"]}
    expected_queries = {name: client.queries(c) for name, client in clients.items()}
    if any(q["query"] not in expected_queries[q["source"]] for q in state["queries"]):
        raise ValidationError("checkpoint queries contradict the acquisition criteria")
    if not state["queries"]:
        for name, client in clients.items():
            s["coverage"]["sources"].setdefault(name, {"pages": 0, "candidates": 0, "errors": []})
            state["queries"].extend({"source": name, "query": query, "offset": 0, "pending": [],
                                     "exhausted": False, "seen_pages": []} for query in expected_queries[name])
    if stop_at_target and existing["outcome"] == "target_met":
        s["coverage"]["stopping_reason"] = "target_met"
        return s
    seen = set()
    for v in s["vacancies"]:
        seen.update(identities(v)[1])
    added = 0
    unique_count = existing["coverage"]["inspected_count"]
    primary_seen = {identities(v)[0] for v in s["vacancies"]}
    while added < batch_size and unique_count < c["discovery_budget"]:
        live = [q for q in state["queries"] if not q["exhausted"] or q["pending"]]
        if not live:
            break
        index = state["next_query"] % len(state["queries"])
        state["next_query"] = (index + 1) % len(state["queries"])
        q = state["queries"][index]
        if q["exhausted"] and not q["pending"]:
            continue
        client = clients[q["source"]]
        source_coverage = s["coverage"]["sources"][q["source"]]
        if not q["pending"]:
            try:
                page = client.page(q["query"], q["offset"])
                source_coverage["pages"] += 1
                q["offset"] += client.page_size
                signature = sorted(identities(v)[0] for v in page)
                if not page:
                    q["exhausted"] = True
                    continue
                if signature in q["seen_pages"]:
                    raise ValidationError("source repeated an earlier page; pagination stopped")
                q["seen_pages"].append(signature)
                q["pending"] = page
            except (ValidationError, OSError, ValueError) as exc:
                message = f"{q['source']}: {exc}"
                s["coverage"]["errors"].append(message)
                source_coverage["errors"].append(message)
                q["exhausted"] = True
                continue
        candidate = q["pending"].pop(0)
        if identities(candidate)[1] & seen:
            if identities(candidate)[0] in primary_seen:
                s["coverage"]["duplicates_skipped"] += 1
            else:
                s["vacancies"].append({**candidate, "facts": {}, "fetch_status": "duplicate"})
                primary_seen.add(identities(candidate)[0])
                seen.update(identities(candidate)[1])
            continue
        try:
            vacancy = client.detail(candidate)
        except (ValidationError, OSError, ValueError) as exc:
            message = f"{q['source']}:{candidate.get('source_id')}: {exc}"
            s["coverage"]["errors"].append(message)
            source_coverage["errors"].append(message)
            vacancy = {**candidate, "fetch_status": "error", "fetch_error": str(exc), "facts": {}}
        keys = identities(vacancy)[1]
        if keys & seen:
            s["vacancies"].append(vacancy)
            primary_seen.add(identities(vacancy)[0])
            seen.update(keys)
            unique_count = evaluate(c, s)["coverage"]["inspected_count"]
            continue
        s["vacancies"].append(vacancy)
        seen.update(keys)
        source_coverage["candidates"] += 1
        primary_seen.add(identities(vacancy)[0])
        unique_count += 1
        added += 1
    more = any(not q["exhausted"] or q["pending"] for q in state["queries"])
    s["coverage"]["stopping_reason"] = (
        "discovery_budget" if unique_count >= c["discovery_budget"] else
        "batch_complete" if more else "source_failure" if s["coverage"]["errors"] else "source_exhausted")
    return s


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValidationError(f"cannot read JSON input: {exc}") from None


def encoded(data):
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"


def write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["validate", "acquire", "evaluate"])
    parser.add_argument("--criteria", required=True, help="criteria JSON file")
    parser.add_argument("--snapshot", help="snapshot JSON file; current-run checkpoint for acquire")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between LinkedIn requests")
    parser.add_argument("--output-directory", help="explicitly save artifacts here; defaults to stdout only")
    args = parser.parse_args()
    try:
        c = criteria(read_json(args.criteria))
        snapshot = read_json(args.snapshot) if args.snapshot else None
        if args.mode == "validate":
            result = c
        elif args.mode == "acquire":
            result = acquire(c, snapshot, args.batch_size, args.delay)
        else:
            if snapshot is None:
                raise ValidationError("evaluate requires --snapshot")
            result = evaluate(c, snapshot)
        if args.output_directory:
            directory = Path(args.output_directory)
            write(directory / "criteria.json", encoded(c))
            if args.mode != "validate":
                write(directory / "snapshot.json", encoded(result if args.mode == "acquire" else result["snapshot"]))
            if args.mode == "evaluate":
                write(directory / "results.json", encoded(result))
                write(directory / "shortlist.md", report(result))
        sys.stdout.write(encoded(result))
        return 0
    except (ValidationError, OSError) as exc:
        sys.stderr.write(f"jsf-search: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

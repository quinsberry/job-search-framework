#!/usr/bin/env python3
"""Inspect, add, update, or explicitly migrate an application CSV."""

import argparse
import csv
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from urllib.parse import urlsplit
from uuid import uuid4


COLUMNS = [
    "application_id", "company", "position", "work_type", "status",
    "vacancy_link", "notes", "created_at", "applied_at", "next_interview",
    "next_interview_at", "interview_stages",
]
BUSINESS = set(COLUMNS) - {"application_id", "created_at"}
STATUSES = {"ready", "applied", "screening", "interviewing", "offer",
            "rejected", "withdraw", "closed"}


def read_table(path):
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, strict=True)
        columns = reader.fieldnames or []
        if len(columns) != len(set(columns)) or any(not c.strip() for c in columns):
            raise ValueError("CSV has duplicate or blank column names")
        rows = list(reader)
    if any(None in row or any(v is None for v in row.values()) for row in rows):
        raise ValueError("CSV contains a row with the wrong number of cells")
    ids = [row.get("application_id") for row in rows if row.get("application_id")]
    if len(ids) != len(set(ids)):
        raise ValueError("CSV contains duplicate application IDs")
    return columns, rows


def validate_date(value, timestamp=False):
    if not value:
        return
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        date.fromisoformat(value)
        return
    if timestamp and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})",
        value,
    ):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is not None:
            return
    raise ValueError("Use YYYY-MM-DD" + (" or an ISO timestamp with timezone offset" if timestamp else ""))


def validate_record(row):
    for field in ("company", "position", "work_type", "status", "vacancy_link"):
        if not row.get(field, "").strip():
            raise ValueError(f"Missing required value: {field}")
    if row["work_type"] not in {"remote", "hybrid", "onsite"}:
        raise ValueError("work_type must be remote, hybrid, or onsite")
    if row["status"] not in STATUSES:
        raise ValueError("Unsupported status: " + row["status"])
    url = urlsplit(row["vacancy_link"])
    if url.scheme not in {"http", "https"} or not url.netloc or any(c.isspace() for c in row["vacancy_link"]):
        raise ValueError("vacancy_link must be an HTTP(S) URL")
    validate_date(row["applied_at"])
    validate_date(row["next_interview_at"], timestamp=True)
    if row["status"] == "ready" and row["applied_at"]:
        raise ValueError("A ready application must have an empty applied_at")
    if row["next_interview_at"] and not row["next_interview"].strip():
        raise ValueError("An interview date requires next_interview")


def write_table(path, columns, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="",
                                         dir=path.parent, delete=False) as target:
            temporary = Path(target.name)
            writer = csv.DictWriter(target, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
            target.flush()
            os.fsync(target.fileno())
        if path.exists():
            temporary.chmod(path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def operate(args):
    if not args.directory.strip():
        raise ValueError("A destination directory is required")
    path = Path(args.directory).expanduser().absolute() / "applications_table.csv"
    columns, rows = read_table(path)
    missing = [column for column in COLUMNS if column not in columns]
    if args.command == "inspect":
        return {"path": str(path), "exists": path.exists(), "columns": columns,
                "missing_columns": missing if path.exists() else [], "records": rows}
    if args.command == "migrate":
        if not path.exists():
            raise ValueError("No existing CSV to migrate; use add for a new table")
        if not missing and all(row["application_id"] for row in rows):
            return {"path": str(path), "changed": False}
        for row in rows:
            for field in missing:
                row[field] = ""
            if not row["application_id"]:
                row["application_id"] = str(uuid4())
        backup = path.with_name(path.name + "." + uuid4().hex + ".bak")
        shutil.copy2(path, backup)
        write_table(path, columns + missing, rows)
        return {"path": str(path), "changed": True, "added_columns": missing,
                "backup": str(backup)}
    if path.exists() and missing:
        raise ValueError("Migration approval required; missing columns: " + ", ".join(missing))
    if args.command == "update" and not path.exists():
        raise ValueError("Cannot update a missing CSV")
    with Path(args.data_file).open(encoding="utf-8") as source:
        data = json.load(source)
    if not isinstance(data, dict) or any(not isinstance(v, str) for v in data.values()):
        raise ValueError("Data must be a JSON object with string values")
    if set(data) - BUSINESS:
        raise ValueError("Unknown or immutable input fields: " + ", ".join(sorted(set(data) - BUSINESS)))
    if args.command == "add":
        if BUSINESS - set(data):
            raise ValueError("Missing input fields: " + ", ".join(sorted(BUSINESS - set(data))))
        matches = [row for row in rows if row["vacancy_link"] == data["vacancy_link"]]
        if matches and not args.allow_duplicate:
            raise ValueError("Duplicate vacancy; ask user to update or create separately. IDs: "
                             + ", ".join(row["application_id"] for row in matches))
        row = dict.fromkeys(columns or COLUMNS, "")
        row.update(data)
        row["application_id"] = str(uuid4())
        row["created_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        validate_record(row)
        rows.append(row)
        changed = COLUMNS
    else:
        if not data:
            raise ValueError("An update requires intended changes")
        matches = [row for row in rows if row["application_id"] == args.application_id]
        if not args.application_id.strip() or len(matches) != 1:
            raise ValueError("application_id must identify exactly one existing record")
        row = matches[0]
        original = row.copy()
        if args.notes_mode and "notes" not in data:
            raise ValueError("notes-mode requires a notes field")
        if "notes" in data:
            if args.notes_mode == "clear":
                if data["notes"]:
                    raise ValueError("Clearing notes requires an empty notes value")
            elif args.notes_mode != "replace":
                data["notes"] = "\n".join(v for v in (row["notes"], data["notes"]) if v)
        row.update(data)
        validate_record(row)
        changed = [field for field in data if row[field] != original[field]]
    write_table(path, columns or COLUMNS, rows)
    return {"path": str(path), "application_id": row["application_id"],
            "operation": args.command, "changed_fields": changed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "add", "update", "migrate"):
        command = commands.add_parser(name)
        command.add_argument("--directory", required=True)
        if name in {"add", "update"}:
            command.add_argument("--data-file", required=True)
        if name == "add":
            command.add_argument("--allow-duplicate", action="store_true")
        if name == "update":
            command.add_argument("--application-id", required=True)
            command.add_argument("--notes-mode", choices=("append", "replace", "clear"))
    try:
        print(json.dumps(operate(parser.parse_args()), ensure_ascii=False))
    except (ValueError, OSError, csv.Error) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

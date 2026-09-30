"""Run with python3 scripts/test_applications.py; uses only temporary files."""

import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from applications import COLUMNS


def check():
    script = Path(__file__).with_name("applications.py")
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        directory = root / "new" / "applications"
        payload = root / "input.json"

        def run(command, data=None, *options, ok=True, destination=directory):
            args = [sys.executable, str(script), command, "--directory", str(destination)]
            if data is not None:
                payload.write_text(json.dumps(data), encoding="utf-8")
                args += ["--data-file", str(payload)]
            result = subprocess.run(args + list(options), capture_output=True, text=True)
            assert (result.returncode == 0) == ok, result.stderr or result.stdout
            return json.loads(result.stdout if ok else result.stderr)

        data = dict(company='Example, "Company"', position="Engineer", work_type="remote",
                    status="ready", vacancy_link="https://example.com/jobs/1",
                    notes="Recruiter: LinkedIn\nZażółć", applied_at="",
                    next_interview="", next_interview_at="", interview_stages="")
        assert not run("inspect")["exists"]
        assert not directory.exists()
        run("update", {"status": "applied"}, "--application-id", "missing", ok=False)
        run("add", {key: value for key, value in data.items() if key != "notes"}, ok=False)
        assert not directory.exists()
        added = run("add", data)
        identity = added["application_id"]
        row = run("inspect")["records"][0]
        assert row["notes"] == data["notes"] and row["company"] == data["company"]
        created = row["created_at"]
        table = Path(added["path"])
        before = table.read_bytes()
        run("add", data, ok=False)
        run("update", {"status": "tech-interview-1"}, "--application-id", identity, ok=False)
        run("update", {"next_interview": "tech-interview-2", "next_interview_at": "2026-10-05T14:00:00"},
            "--application-id", identity, ok=False)
        run("update", {"applied_at": "2026-02-30"}, "--application-id", identity, ok=False)
        assert table.read_bytes() == before
        updated = run("update", {"status": "interviewing", "applied_at": "2026-09-30",
                                 "notes": "Latest conversation: email", "next_interview": "tech-interview-2",
                                 "next_interview_at": "2026-10-05T14:00:00+02:00",
                                 "interview_stages": "hr-interview; tech-interview-1; tech-interview-2"},
                      "--application-id", identity)
        assert "notes" in updated["changed_fields"]
        row = run("inspect")["records"][0]
        assert row["notes"] == data["notes"] + "\nLatest conversation: email"
        assert row["created_at"] == created and row["company"] == data["company"]
        run("update", {"notes": "Replacement"}, "--application-id", identity, "--notes-mode", "replace")
        assert run("inspect")["records"][0]["notes"] == "Replacement"
        run("update", {"notes": ""}, "--application-id", identity, "--notes-mode", "clear")
        assert run("inspect")["records"][0]["notes"] == ""
        separate = run("add", data, "--allow-duplicate")
        assert separate["application_id"] != identity
        assert len(run("inspect")["records"]) == 2

        legacy = root / "legacy"
        legacy.mkdir()
        legacy_table = legacy / "applications_table.csv"
        with legacy_table.open("w", encoding="utf-8", newline="") as target:
            writer = csv.DictWriter(target, fieldnames=["company", "notes", "custom"])
            writer.writeheader()
            writer.writerow({"company": "Old company", "notes": "Keep me", "custom": "extra"})
        before = legacy_table.read_bytes()
        run("add", data, destination=legacy, ok=False)
        assert legacy_table.read_bytes() == before
        migrated = run("migrate", destination=legacy)
        assert Path(migrated["backup"]).read_bytes() == before
        inspection = run("inspect", destination=legacy)
        assert not inspection["missing_columns"]
        legacy_row = inspection["records"][0]
        assert legacy_row["custom"] == "extra" and legacy_row["notes"] == "Keep me"
        assert legacy_row["application_id"] and not legacy_row["created_at"]
        run("add", data, destination=legacy)
        assert run("inspect", destination=legacy)["records"][0] == legacy_row
        assert not run("migrate", destination=legacy)["changed"]
        assert set(COLUMNS).issubset(inspection["columns"])

        malformed = root / "malformed"
        malformed.mkdir()
        bad_table = malformed / "applications_table.csv"
        bad_table.write_text("company,notes\nExample,note,unexpected\n", encoding="utf-8")
        before = bad_table.read_bytes()
        run("migrate", destination=malformed, ok=False)
        assert bad_table.read_bytes() == before
    print("Application CSV checks passed")


if __name__ == "__main__":
    check()

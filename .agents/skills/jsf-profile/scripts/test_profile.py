from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from jsf_profile.profile import ValidationError, apply_plan, digest, encoded, extract, load, plan, render, summary


def observation(source, value, quote, correction=False, page=1):
    result = {"value": value, "evidence": [{"source_id": source["id"], "page": page, "quote": quote}]}
    if correction:
        result["correction"] = True
    return result


def change(source, records, **extra):
    return {"schema_version": 1, "sources": [source], "records": records, **extra}


def record(identifier, section, **facts):
    return {"id": identifier, "section": section, "facts": facts}


def make_pdf(contents):
    """Minimal real PDF fixture with a Helvetica text layer or blank page."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               b"<< /Length " + str(len(contents)).encode() + b" >>\nstream\n" + contents + b"\nendstream"]
    data = b"%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    start = len(data)
    data += b"xref\n0 6\n0000000000 65535 f \n"
    data += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    return data + f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.workspace = self.root / "workspace"
        self.cv = self.root / "CV.md"
        self.cv.write_text("# Ada Example\nFrontend Engineer at Acme, 2020–present.\nReact and TypeScript.\nEnglish.\n", encoding="utf-8")
        self.source = extract(self.cv)["source"]
        self.initial = change(self.source, [
            record("identity", "identity", full_name=observation(self.source, "Ada Example", "Ada Example")),
            record("acme-frontend", "experience", company=observation(self.source, "Acme", "Frontend Engineer at Acme"),
                   role=observation(self.source, "Frontend Engineer", "Frontend Engineer at Acme"),
                   start_date=observation(self.source, "2020", "2020–present"),
                   end_date=observation(self.source, "present", "2020–present"),
                   technologies=observation(self.source, ["React", "TypeScript"], "React and TypeScript"))])

    def tearDown(self):
        self.temporary.cleanup()

    def source_from(self, name, text, kind="cv"):
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return extract(path, kind)["source"]

    def test_markdown_unicode_source_is_stable_and_original_unchanged(self):
        before = self.cv.read_bytes()
        self.assertEqual(extract(self.cv), extract(self.cv))
        self.assertIn("2020–present", self.source["pages"][0]["text"])
        apply_plan(self.workspace, plan(None, self.initial))
        self.assertEqual(before, self.cv.read_bytes())

    def test_real_pdf_text_layer_and_unreadable_pdf_reporting(self):
        pdf = self.root / "CV.pdf"
        pdf.write_bytes(make_pdf(b"BT /F1 12 Tf 72 720 Td (Ada Example - React Engineer) Tj ET"))
        result = extract(pdf)
        self.assertEqual(result["outcome"], "ready")
        self.assertIn("Ada Example", result["source"]["pages"][0]["text"])
        pdf.write_bytes(make_pdf(b"q Q"))
        self.assertEqual(extract(pdf)["outcome"], "needs_clarification")
        pdf.write_bytes(b"not a PDF")
        self.assertEqual(extract(pdf)["outcome"], "needs_clarification")

    def test_encrypted_pdf_requests_unlocked_source(self):
        from pypdf import PdfWriter
        path = self.root / "encrypted.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.encrypt("secret")
        writer.write(path)
        result = extract(path)
        self.assertEqual(result["outcome"], "needs_clarification")
        self.assertTrue(any("encrypted" in issue for issue in result["source"]["issues"]))

    def test_no_empty_successful_profile_artifacts(self):
        empty = self.source_from("empty.md", "")
        proposal = plan(None, change(empty, []))
        self.assertEqual(proposal["outcome"], "needs_clarification")
        with self.assertRaises(ValidationError):
            apply_plan(self.workspace, proposal)
        self.assertFalse(self.workspace.exists())

    def test_planning_is_pure_and_read_only(self):
        before = deepcopy(self.initial)
        first, second = plan(None, self.initial), plan(None, self.initial)
        self.assertEqual(encoded(first), encoded(second))
        self.assertEqual(before, self.initial)
        self.assertFalse(self.workspace.exists())

    def test_complete_profile_ready_and_missing_level_partial(self):
        base = plan(None, self.initial)
        self.assertEqual(base["outcome"], "ready")
        partial = plan(base["profile"], change(self.source, [record("english", "languages", name=observation(self.source, "English", "English"))]))
        self.assertEqual(partial["outcome"], "partial")
        self.assertIn({"record_id": "english", "field": "level"}, partial["unknowns"])
        self.assertIn("Level:** Unknown", render(partial["profile"]))
        apply_plan(self.workspace, plan(None, change(self.source, [record("english", "languages", name=observation(self.source, "English", "English"))])))
        self.assertTrue((self.workspace / "candidate" / "README.md").exists())

    def test_round_trip_and_reimport_are_idempotent(self):
        apply_plan(self.workspace, plan(None, self.initial))
        existing = load(self.workspace)
        files = {p.name: p.read_bytes() for p in (self.workspace / "candidate").iterdir()}
        times = {p.name: p.stat().st_mtime_ns for p in (self.workspace / "candidate").iterdir()}
        replay = plan(existing, self.initial)
        self.assertEqual(replay["profile"], existing)
        apply_plan(self.workspace, replay)
        self.assertEqual(files, {p.name: p.read_bytes() for p in (self.workspace / "candidate").iterdir()})
        self.assertEqual(times, {p.name: p.stat().st_mtime_ns for p in (self.workspace / "candidate").iterdir()})
        self.assertEqual(set(files), {"profile.yaml", "README.md"})

    def test_multiple_evidence_entries_are_idempotent_on_first_reimport(self):
        fact = self.initial["records"][1]["facts"]["technologies"]
        fact["evidence"] = [{"source_id": self.source["id"], "page": 1, "quote": "TypeScript"},
                            {"source_id": self.source["id"], "page": 1, "quote": "React"}]
        initial = plan(None, self.initial)["profile"]
        self.assertEqual(initial, plan(initial, self.initial)["profile"])

    def test_list_reordering_does_not_conflict_with_a_user_correction(self):
        initial = plan(None, self.initial)["profile"]
        user = self.source_from("tech.md", "My technologies are React and TypeScript.", "user")
        corrected = plan(initial, change(user, [record("acme-frontend", "experience", technologies=observation(user, ["React", "TypeScript"], "React and TypeScript", True))]))["profile"]
        patch = deepcopy(self.initial)
        patch["records"][1]["facts"]["technologies"]["value"] = ["typescript", "react"]
        self.assertEqual(plan(corrected, patch)["conflicts"], [])

    def test_readme_has_friendly_headings_and_current_role_first(self):
        source = self.source_from("older.md", "Web Developer at Cedar, 2018–2019.")
        older = record("a-cedar", "experience", company=observation(source, "Cedar", "Cedar"),
                       role=observation(source, "Web Developer", "Web Developer"),
                       start_date=observation(source, "2018", "2018–2019"), end_date=observation(source, "2019", "2018–2019"))
        result = plan(plan(None, self.initial)["profile"], change(source, [older]))
        view = render(result["profile"])
        self.assertIn("### Frontend Engineer — Acme", view)
        self.assertLess(view.index("### Frontend Engineer — Acme"), view.index("### Web Developer — Cedar"))

    def test_shorter_cv_preserves_omitted_history_fields_and_list_entries(self):
        existing = plan(None, self.initial)["profile"]
        short = self.source_from("short.md", "Ada Example. Acme. React.")
        patch = change(short, [record("acme-frontend", "experience", technologies=observation(short, ["React"], "React"))])
        result = plan(existing, patch)
        facts = next(r["facts"] for r in result["profile"]["records"] if r["id"] == "acme-frontend")
        self.assertEqual(facts["technologies"]["value"], ["React", "TypeScript"])
        self.assertEqual(facts["start_date"]["value"], "2020")
        self.assertEqual(len(result["profile"]["records"]), 2)
        self.assertEqual(existing, plan(None, self.initial)["profile"])

    def test_new_cv_conflict_preserves_previous_fact_and_deduplicates_conflict(self):
        existing = plan(None, self.initial)["profile"]
        updated = self.source_from("new.md", "Software Engineer at Acme.")
        changes = change(updated, [record("acme-frontend", "experience", role=observation(updated, "Software Engineer", "Software Engineer at Acme"))])
        result = plan(existing, changes)
        self.assertEqual(result["outcome"], "partial")
        self.assertEqual(result["conflicts"][0]["existing"]["value"], "Frontend Engineer")
        self.assertEqual(len(plan(result["profile"], changes)["conflicts"]), 1)
        self.assertIn("needs clarification (conflicting evidence)", render(result["profile"]))

    def test_explicit_correction_resolves_conflict_and_is_not_undone(self):
        existing = plan(None, self.initial)["profile"]
        revised = self.source_from("new.md", "Software Engineer at Acme.")
        pending = plan(existing, change(revised, [record("acme-frontend", "experience", role=observation(revised, "Software Engineer", "Software Engineer"))]))["profile"]
        user = self.source_from("correction.md", "My Acme role was Software Engineer.", "user")
        corrected = plan(pending, change(user, [record("acme-frontend", "experience", role=observation(user, "Software Engineer", "My Acme role was Software Engineer", True))]))
        self.assertEqual(corrected["conflicts"], [])
        final = plan(corrected["profile"], self.initial)
        self.assertEqual(final["conflicts"][0]["existing"]["value"], "Software Engineer")

    def test_explicit_clearing_is_preserved_against_later_cv(self):
        existing = plan(None, self.initial)["profile"]
        user = self.source_from("clear.md", "Remove my start date until I confirm it.", "user")
        cleared = plan(existing, change(user, [record("acme-frontend", "experience", start_date=observation(user, None, "Remove my start date until I confirm it", True))]))
        final = plan(cleared["profile"], self.initial)
        fact = next(r for r in final["profile"]["records"] if r["id"] == "acme-frontend")["facts"]["start_date"]
        self.assertIsNone(fact["value"])
        self.assertEqual(len(final["conflicts"]), 1)

    def test_unknown_does_not_clear_supported_value(self):
        base = plan(None, self.initial)["profile"]
        result = plan(base, change(self.source, [record("acme-frontend", "experience", start_date={"value": None, "evidence": []})]))
        self.assertEqual(result["profile"], base)

    def test_evidence_must_match_specific_source_page(self):
        for quote, page in (("invented impact of 50%", 1), ("Ada Example", 2)):
            with self.subTest(quote=quote, page=page), self.assertRaises(ValidationError):
                plan(None, change(self.source, [record("identity", "identity", full_name=observation(self.source, "Ada Example", quote, page=page))]))

    def test_cv_cannot_be_marked_as_explicit_user_correction(self):
        self.initial["records"][0]["facts"]["full_name"]["correction"] = True
        with self.assertRaisesRegex(ValidationError, "user statements"):
            plan(None, self.initial)

    def test_stale_plan_leaves_all_artifacts_unchanged(self):
        apply_plan(self.workspace, plan(None, self.initial))
        old = load(self.workspace)
        stale = plan(old, change(self.source, [], issues=["Review dates"]))
        apply_plan(self.workspace, plan(old, change(self.source, [], issues=["Review language"])))
        before = {p.name: p.read_bytes() for p in (self.workspace / "candidate").iterdir()}
        with self.assertRaisesRegex(ValidationError, "changed since planning"):
            apply_plan(self.workspace, stale)
        self.assertEqual(before, {p.name: p.read_bytes() for p in (self.workspace / "candidate").iterdir()})

    def test_changed_plan_contents_and_removed_history_are_rejected(self):
        apply_plan(self.workspace, plan(None, self.initial))
        proposal = plan(load(self.workspace), change(self.source, []))
        proposal["profile"]["records"].pop()
        with self.assertRaisesRegex(ValidationError, "contents changed"):
            apply_plan(self.workspace, proposal)
        proposal["revision"] = digest(proposal["profile"])
        with self.assertRaisesRegex(ValidationError, "remove existing records"):
            apply_plan(self.workspace, proposal)

    def test_unsafe_yaml_and_duplicate_keys_are_rejected(self):
        directory = self.workspace / "candidate"
        directory.mkdir(parents=True)
        path = directory / "profile.yaml"
        for contents in ("!!python/object/apply:os.system ['touch never']", "schema_version: 1\nschema_version: 2\n"):
            path.write_text(contents, encoding="utf-8")
            with self.assertRaises(ValidationError):
                load(self.workspace)
        self.assertFalse((self.root / "never").exists())

    def test_generated_view_is_not_authoritative(self):
        apply_plan(self.workspace, plan(None, self.initial))
        directory = self.workspace / "candidate"
        (directory / "README.md").write_text("Untrusted edits", encoding="utf-8")
        (directory / "profile.json").write_text("{}", encoding="utf-8")
        self.assertEqual(summary(load(self.workspace))["outcome"], "ready")

    def test_export_reads_yaml_edits_and_render_removes_legacy_json(self):
        import yaml
        apply_plan(self.workspace, plan(None, self.initial))
        directory = self.workspace / 'candidate'
        path = directory / 'profile.yaml'
        profile = load(self.workspace)
        profile['issues'].append('User edited YAML')
        path.write_text('# Keep this comment\n' + yaml.safe_dump(profile))
        legacy = directory / 'profile.json'
        legacy.write_text('{}')
        helper = str(Path(__file__).with_name('profile.py'))
        before = path.read_bytes()
        exported = subprocess.run([sys.executable, helper, 'export', '--workspace', str(self.workspace)], capture_output=True, text=True, check=True)
        self.assertIn('User edited YAML', json.loads(exported.stdout)['issues'])
        self.assertEqual(path.read_bytes(), before)
        self.assertTrue(legacy.exists())  # Export remains read-only.
        subprocess.run([sys.executable, helper, 'render', '--workspace', str(self.workspace)], capture_output=True, check=True)
        self.assertFalse(legacy.exists())
        self.assertEqual(path.read_bytes(), before)
        self.assertIn('User edited YAML', (directory / 'README.md').read_text())

    def test_source_cannot_overlap_readme_output(self):
        path = self.workspace / "candidate" / "README.md"
        path.parent.mkdir(parents=True)
        path.write_text("Ada Example", encoding="utf-8")
        source = extract(path)["source"]
        proposal = plan(None, change(source, [record("identity", "identity", full_name=observation(source, "Ada Example", "Ada Example"))]))
        with self.assertRaisesRegex(ValidationError, "overlaps"):
            apply_plan(self.workspace, proposal)
        self.assertEqual(path.read_text(), "Ada Example")

    def test_source_identity_is_stable_across_rename_and_distinct_for_user_statements(self):
        renamed = self.root / "Renamed.md"
        renamed.write_bytes(self.cv.read_bytes())
        second = extract(renamed)["source"]
        self.assertEqual(second["id"], self.source["id"])
        self.assertNotEqual(extract(renamed, "user")["source"]["id"], second["id"])
        base = plan(None, self.initial)["profile"]
        self.assertEqual(plan(base, change(second, []))["profile"], base)

    def test_cli_extract_plan_apply_export_render(self):
        helper = str(Path(__file__).with_name("profile.py"))
        def run(*args, success=True):
            process = subprocess.run([sys.executable, helper, *args], capture_output=True, text=True)
            self.assertEqual(process.returncode, 0 if success else 2, process.stderr)
            return json.loads(process.stdout) if success else process
        self.assertEqual(run("extract", "--source", str(self.cv))["outcome"], "ready")
        changes = self.root / "changes.json"
        changes.write_text(encoded(self.initial), encoding="utf-8")
        proposal = run("plan", "--changes", str(changes), "--workspace", str(self.workspace))
        self.assertFalse(self.workspace.exists())
        path = self.root / "plan.json"
        path.write_text(encoded(proposal), encoding="utf-8")
        applied = run("apply", "--plan", str(path), "--workspace", str(self.workspace))
        self.assertEqual(applied, run("export", "--workspace", str(self.workspace)))
        before = {p.name: p.read_bytes() for p in (self.workspace / "candidate").iterdir()}
        self.assertEqual(applied, run("render", "--workspace", str(self.workspace)))
        self.assertEqual(before, {p.name: p.read_bytes() for p in (self.workspace / "candidate").iterdir()})
        run("apply", "--plan", str(path), "--workspace", str(self.workspace), success=False)


if __name__ == "__main__":
    unittest.main()

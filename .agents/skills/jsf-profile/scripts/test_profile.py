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

    def test_complete_profile_and_language_without_level_are_ready(self):
        base = plan(None, self.initial)
        self.assertEqual(base["outcome"], "ready")
        partial = plan(base["profile"], change(self.source, [record("english", "languages", name=observation(self.source, "English", "English"))]))
        self.assertEqual(partial["outcome"], "ready")
        self.assertNotIn({"record_id": "english", "field": "level"}, partial["unknowns"])
        self.assertIn("- English", render(partial["profile"]))
        apply_plan(self.workspace, plan(None, change(self.source, [record("english", "languages", name=observation(self.source, "English", "English"))])))
        self.assertTrue((self.workspace / "candidate" / "profile.md").exists())

    def test_round_trip_and_reimport_are_idempotent(self):
        apply_plan(self.workspace, plan(None, self.initial))
        existing = load(self.workspace)
        files = {str(p.relative_to(self.workspace / "candidate")): p.read_bytes() for p in (self.workspace / "candidate").rglob("*") if p.is_file()}
        times = {p.name: p.stat().st_mtime_ns for p in (self.workspace / "candidate").rglob("*") if p.is_file()}
        replay = plan(existing, self.initial)
        self.assertEqual(replay["profile"], existing)
        apply_plan(self.workspace, replay)
        self.assertEqual(files, {str(p.relative_to(self.workspace / "candidate")): p.read_bytes() for p in (self.workspace / "candidate").rglob("*") if p.is_file()})
        self.assertEqual(times, {p.name: p.stat().st_mtime_ns for p in (self.workspace / "candidate").rglob("*") if p.is_file()})
        self.assertIn("profile.md", files)
        self.assertFalse((self.workspace / "candidate/profile.yaml").exists())

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
        self.assertEqual(summary(result["profile"])["outcome"], "partial")

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
        before = {str(p.relative_to(self.workspace / "candidate")): p.read_bytes() for p in (self.workspace / "candidate").rglob("*") if p.is_file()}
        with self.assertRaisesRegex(ValidationError, "changed since planning"):
            apply_plan(self.workspace, stale)
        self.assertEqual(before, {str(p.relative_to(self.workspace / "candidate")): p.read_bytes() for p in (self.workspace / "candidate").rglob("*") if p.is_file()})

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

    def test_export_reads_markdown_edits_without_writes(self):
        apply_plan(self.workspace, plan(None, self.initial))
        path = self.workspace / 'candidate/profile.md'
        path.write_text(path.read_text().replace('**Full Name:** Ada Example', '**Full Name:** Ada Updated'))
        before = {str(p): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()}
        helper = str(Path(__file__).with_name('profile.py'))
        result = subprocess.run([sys.executable, helper, 'export', '--workspace', str(self.workspace)], capture_output=True, text=True, check=True)
        profile = json.loads(result.stdout)['profile']
        name = profile['records'][0]['facts']['full_name']
        self.assertEqual(name['value'], 'Ada Updated')
        self.assertTrue(name['user_corrected'])
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()})

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
        before = {str(p.relative_to(self.workspace / "candidate")): p.read_bytes() for p in (self.workspace / "candidate").rglob("*") if p.is_file()}
        self.assertEqual(applied, run("render", "--workspace", str(self.workspace)))
        self.assertEqual(before, {str(p.relative_to(self.workspace / "candidate")): p.read_bytes() for p in (self.workspace / "candidate").rglob("*") if p.is_file()})
        run("apply", "--plan", str(path), "--workspace", str(self.workspace), success=False)

    def test_legacy_migrates_only_on_save_with_exact_backups(self):
        import yaml
        from jsf_profile import profile as owner
        profile=plan(None,self.initial)['profile']
        profile['issues']=['Keep unresolved issue']
        directory=self.workspace/'candidate';directory.mkdir(parents=True)
        old=yaml.safe_dump(profile,allow_unicode=True)
        (directory/'profile.yaml').write_text(old)
        (directory/'README.md').write_text('Previous generated view')
        before={str(p):p.read_bytes() for p in directory.rglob('*') if p.is_file()}
        self.assertEqual(load(self.workspace),profile)
        self.assertEqual(before,{str(p):p.read_bytes() for p in directory.rglob('*') if p.is_file()})
        owner.persist(self.workspace,profile)
        self.assertEqual(load(self.workspace),profile)
        self.assertFalse((directory/'profile.yaml').exists())
        self.assertFalse((directory/'README.md').exists())
        self.assertEqual(next((directory/'backups').rglob('profile.yaml')).read_text(),old)
        self.assertEqual(next((directory/'backups').rglob('README.md')).read_text(),'Previous generated view')

    def test_evidence_write_failure_preserves_legacy_authority_and_retry(self):
        import yaml
        from unittest.mock import patch
        from jsf_profile import profile as owner
        profile=plan(None,self.initial)['profile']
        directory=self.workspace/'candidate';directory.mkdir(parents=True)
        (directory/'profile.yaml').write_text(yaml.safe_dump(profile))
        real=owner.atomic_write
        def fail(file,text):
            if file.name=='profile.md':raise OSError('Disk full')
            return real(file,text)
        with patch.object(owner,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError):owner.persist(self.workspace,profile)
        self.assertEqual(load(self.workspace),profile)
        self.assertFalse((directory/'profile.md').exists())
        owner.persist(self.workspace,profile)
        self.assertEqual(load(self.workspace),profile)

    def test_manual_edits_preserve_other_evidence_and_clear_removed_claims(self):
        from jsf_profile import profile as owner
        original=plan(None,self.initial)['profile']
        text=render(original).replace('**Full Name:** Ada Example','**Full Name:** Ada Updated')
        text=text.replace('  - React\n','')
        proposal=owner.edit_plan(original,text,digest(original))
        name=proposal['profile']['records'][0]['facts']['full_name']
        self.assertTrue(name['user_corrected'])
        experience=next(r for r in proposal['profile']['records'] if r['section']=='experience')
        old=next(r for r in original['records'] if r['section']=='experience')
        self.assertEqual(experience['facts']['company'],old['facts']['company'])
        self.assertEqual(experience['facts']['technologies']['value'],['TypeScript'])
        self.assertTrue(experience['facts']['technologies']['user_corrected'])
        cleared=owner.edit_plan(original,render(original).replace('- **Full Name:** Ada Example','- **Full Name:** Unknown'),digest(original))
        self.assertIsNone(cleared['profile']['records'][0]['facts']['full_name']['value'])
        self.assertTrue(cleared['profile']['records'][0]['facts']['full_name']['user_corrected'])

    def test_support_has_provenance_without_duplicate_current_fact_values(self):
        from jsf_profile.markdown_profile import support
        profile=plan(None,self.initial)['profile']
        metadata=support(profile)
        fact=metadata['records']['identity']['facts']['full_name']
        self.assertNotIn('value',fact)
        self.assertIn('fingerprint',fact)
        self.assertEqual(fact['evidence'],profile['records'][0]['facts']['full_name']['evidence'])

    def test_markdown_round_trip_multiline_lists_special_text_and_unknown_literal(self):
        from jsf_profile import profile as owner
        existing=plan(None,self.initial)['profile']
        text=render(existing).replace('- **Full Name:** Ada Example','- **Full Name:** &#85;nknown').replace('- **Full Name:** &#85;nknown','- **Full Name:** &#85;nknown\n- **Summary:** A &amp; B &lt;br&gt;<br>Next line')
        proposal=owner.edit_plan(existing,text,digest(existing))
        owner.persist(self.workspace,proposal['profile'])
        saved=load(self.workspace)
        self.assertEqual(saved,proposal['profile'])
        self.assertEqual(saved['records'][0]['facts']['full_name']['value'],'Unknown')
        self.assertEqual(saved['records'][0]['facts']['summary']['value'],'A & B <br>\nNext line')

    def test_invalid_manual_edits_do_not_write(self):
        from jsf_profile import profile as owner
        apply_plan(self.workspace,plan(None,self.initial))
        original=load(self.workspace)
        for text in [render(original)+'\nUnstructured prose',render(original).replace('**Full Name:**','**Unsupported Field:**'),render(original)+'\n## Identity\n### identity\n- **Full Name:** Duplicate']:
            with self.assertRaises(ValidationError):owner.edit_plan(original,text,digest(original))
        self.assertEqual(load(self.workspace),original)


    def test_template_shows_all_sections_and_fields_without_example_records(self):
        from jsf_profile import profile as owner
        from jsf_profile.markdown_profile import parse
        from jsf_profile.profile_template import definition
        original=plan(None,self.initial)['profile']
        text=render(original)
        self.assertEqual([line[3:].lower() for line in text.splitlines() if line.startswith('## ')],list(owner.FIELDS))
        records=parse(text)
        self.assertEqual({r['id'] for r in records},{r['id'] for r in original['records']})
        for record in records:
            self.assertTrue(set(owner.EXPECTED[record['section']])<=set(record['facts']))
            self.assertTrue(set(record['facts'])<=set(owner.FIELDS[record['section']]))
        self.assertNotIn('<!-- Example:',text)
        self.assertNotIn('Alex Example',text)
        self.assertNotIn('Example University',text)
        self.assertEqual(set(definition()['sections'][0]['fields'][0]),{'id','label','type','example'})

    def test_template_controls_field_order_and_rejects_schema_drift(self):
        from unittest.mock import patch
        from jsf_profile import profile_template as template
        original=plan(None,self.initial)['profile']
        source=template.PATH.read_text()
        first='<!-- Example: "Alex Example" -->\n- **Full Name:** Unknown'
        second='<!-- Example: "Warsaw, Poland" -->\n- **Location:** Unknown'
        reordered=source.replace(first,'SLOT').replace(second,first).replace('SLOT',second)
        path=self.root/'template.md';path.write_text(reordered)
        with patch.object(template,'PATH',path):
            original['records'][0]['facts']['location']={'value':'Warsaw, Poland','evidence':original['records'][0]['facts']['full_name']['evidence']}
            text=render(original)
            self.assertLess(text.index('**Location:**'),text.index('**Full Name:**'))
        for invalid in [source.replace(first,''),source.replace('<!-- Example: ["https://example.com", "https://github.com/example"] -->','<!-- Example: "https://example.com" -->')]:
            path.write_text(invalid)
            with patch.object(template,'PATH',path):
                with self.assertRaises(ValidationError):template.definition()

    def test_optional_unknowns_do_not_create_warnings_or_facts_during_render(self):
        from jsf_profile import profile as owner
        original=plan(None,self.initial)['profile']
        original['records'][0]['facts']['email']={'value':None,'evidence':[]}
        self.assertEqual(summary(original)['outcome'],'ready')
        proposal=owner.edit_plan(original,render(original),digest(original))
        self.assertEqual(proposal['profile'],original)
        self.assertEqual(proposal['unknowns'],[])
        self.assertNotIn('**Phone:**',render(original))

    def test_new_fact_shapes_and_manual_list_edits_are_validated(self):
        from jsf_profile import profile as owner
        original=plan(None,self.initial)['profile']
        for field,value in [('links','https://example.com'),('full_name',['Ada Example'])]:
            patch=change(self.source,[record('identity','identity',**{field:observation(self.source,value,'Ada Example')})])
            with self.assertRaises(ValidationError):plan(original,patch)
        text=render(original).replace('- **Full Name:** Ada Example','- **Full Name:** Ada Example\n- **Links:**\n  - https://example.com\n  - https://github.com/example')
        edited=owner.edit_plan(original,text,digest(original))['profile']
        self.assertEqual(edited['records'][0]['facts']['links']['value'],['https://example.com','https://github.com/example'])
        self.assertTrue(edited['records'][0]['facts']['links']['user_corrected'])
        with self.assertRaises(ValidationError):owner.edit_plan(original,render(original).replace('- **Full Name:** Ada Example','- **Full Name:** Ada Example\n- **Links:** https://example.com'),digest(original))

    def test_legacy_fact_shapes_round_trip_without_reinterpreting_evidence(self):
        from jsf_profile import profile as owner
        source=self.source_from('legacy.md','https://example.com')
        profile=plan(None,change(source,[record('identity','identity',links=observation(source,['https://example.com'],'https://example.com'))]))['profile']
        profile['records'][0]['facts']['links']['value']='https://example.com'
        owner.persist(self.workspace,profile)
        self.assertEqual(load(self.workspace),profile)
        self.assertEqual(owner.edit_plan(profile,render(profile),digest(profile))['profile'],profile)
        self.assertNotIn('user_corrected',load(self.workspace)['records'][0]['facts']['links'])

    def test_template_help_is_versioned_and_has_an_example_for_every_field(self):
        from jsf_profile import profile as owner
        helper=str(Path(__file__).with_name('profile.py'))
        result=subprocess.run([sys.executable,helper,'template'],capture_output=True,text=True,check=True)
        help=json.loads(result.stdout)
        self.assertEqual(help['schema_version'],1)
        self.assertEqual([s['id'] for s in help['sections']],list(owner.FIELDS))
        for section in help['sections']:
            self.assertEqual({f['id'] for f in section['fields']},set(owner.FIELDS[section['id']]))
            for field in section['fields']:
                self.assertTrue(field['example']);self.assertTrue(field['markdown_example'].startswith('- '))
                self.assertEqual(field['type']=='list',isinstance(field['example'],list))

    def compact_profile(self):
        source = self.source_from('compact.md', 'React TypeScript English C1 Polish')
        return plan(plan(None, self.initial)['profile'], change(source, [
            record('react', 'skills', name=observation(source, 'React', 'React')),
            record('typescript', 'skills', name=observation(source, 'TypeScript', 'TypeScript')),
            record('english', 'languages', name=observation(source, 'English', 'English'), level=observation(source, 'C1', 'C1')),
            record('polish', 'languages', name=observation(source, 'Polish', 'Polish'))]))['profile']

    def test_compact_lists_round_trip_preserve_ids_evidence_and_optional_language_level(self):
        from jsf_profile import profile as owner
        profile = self.compact_profile()
        profile['records'][0]['id'] = 'candidate-ada'
        text = render(profile)
        self.assertIn('## Skills\n\n- React\n- TypeScript', text)
        self.assertIn('- English — C1', text)
        self.assertIn('- Polish', text)
        self.assertNotIn('id: candidate-ada', text)
        self.assertNotIn('id: react', text)
        self.assertEqual(owner.edit_plan(profile, text, digest(profile))['profile'], profile)
        owner.persist(self.workspace, profile)
        before = {str(p): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()}
        owner.persist(self.workspace, load(self.workspace))
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()})

    def test_compact_list_add_remove_rename_and_clear_level_are_user_edits(self):
        from jsf_profile import profile as owner
        profile = self.compact_profile()
        owner.persist(self.workspace, profile)
        text = render(profile).replace('- React\n', '- AWS\n').replace('- TypeScript\n', '').replace('English — C1', 'English')
        proposal = owner.edit_plan(profile, text, digest(profile))
        owner.apply_plan(self.workspace, proposal)
        saved = load(self.workspace)
        skills = [r for r in saved['records'] if r['section'] == 'skills']
        self.assertEqual([r['facts']['name']['value'] for r in skills], ['AWS'])
        self.assertTrue(skills[0]['facts']['name']['user_corrected'])
        english = next(r for r in saved['records'] if r['id'] == 'english')
        self.assertIsNone(english['facts']['level']['value'])
        self.assertEqual(summary(saved)['outcome'], 'ready')
        self.assertEqual(owner.edit_plan(saved, render(saved), digest(saved))['profile'], saved)

    def test_structured_language_level_correction_does_not_require_repeating_name(self):
        profile = self.compact_profile()
        source = self.source_from('level.md', 'My English level is B2.', 'user')
        updated = plan(profile, change(source, [record('english', 'languages', level=observation(source, 'B2', 'B2', True))]))['profile']
        english = next(r for r in updated['records'] if r['id'] == 'english')
        self.assertEqual(english['facts']['level']['value'], 'B2')
        self.assertEqual(english['facts']['name'], next(r for r in profile['records'] if r['id'] == 'english')['facts']['name'])

    def test_compact_duplicate_names_and_retired_skill_fields_are_rejected(self):
        from jsf_profile import profile as owner
        profile = self.compact_profile()
        for text in [render(profile).replace('- React\n', '- React\n- react\n'),
                     render(profile).replace('- Polish\n', '- Polish\n- Polish — B2\n')]:
            with self.assertRaises(ValidationError): owner.edit_plan(profile, text, digest(profile))
        with self.assertRaises(ValidationError):
            plan(None, change(self.source, [record('react', 'skills', name=observation(self.source, 'React', 'React'), level=observation(self.source, 'expert', 'React'))]))

    def legacy_markdown(self):
        from jsf_profile import markdown_profile as md
        profile = self.compact_profile()
        react = next(r for r in profile['records'] if r['id'] == 'react')
        react['facts']['level'] = deepcopy(react['facts']['name'])
        react['facts']['level']['value'] = 'expert'
        react['facts']['context'] = deepcopy(react['facts']['name'])
        react['facts']['context']['value'] = 'Internal tools'
        metadata = md.support(profile)
        text = ['# Candidate profile', f'<!-- jsf-profile:1 evidence:{digest(metadata)} -->']
        for section in md.p.FIELDS:
            text.append('## ' + section.title())
            for item in profile['records']:
                if item['section'] != section: continue
                text.append('### Legacy record <!-- id: ' + item['id'] + ' -->')
                for key, fact in item['facts'].items():
                    text.extend(md.field_lines(key.replace('_', ' ').title(), fact['value']))
        directory = self.workspace / 'candidate'
        (directory / 'evidence').mkdir(parents=True)
        raw = '\n'.join(text)
        (directory / 'profile.md').write_text(raw)
        (directory / 'evidence' / (digest(metadata) + '.json')).write_text(encoded(metadata))
        return raw, metadata

    def test_version_one_conversion_is_read_only_then_backs_up_original_and_evidence(self):
        from jsf_profile import profile as owner
        raw, metadata = self.legacy_markdown()
        before = {str(p): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()}
        profile = load(self.workspace)
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()})
        react = next(r for r in profile['records'] if r['id'] == 'react')
        self.assertEqual(set(react['facts']), {'name'})
        self.assertEqual(react['facts']['name']['evidence'], metadata['records']['react']['facts']['name']['evidence'])
        owner.persist(self.workspace, profile)
        self.assertEqual(load(self.workspace), profile)
        directory = self.workspace / 'candidate'
        self.assertEqual(next((directory / 'backups').rglob('profile.md')).read_text(), raw)
        self.assertEqual(json.loads(next((directory / 'backups').rglob('*.json')).read_text()), metadata)
        self.assertIn('jsf-profile:2', (directory / 'profile.md').read_text())
        self.assertNotIn('Internal tools', encoded(owner.export(self.workspace)))

    def test_version_one_failed_publication_keeps_original_readable_and_retryable(self):
        from unittest.mock import patch
        from jsf_profile import profile as owner
        raw, _ = self.legacy_markdown()
        profile = load(self.workspace)
        real = owner.atomic_write
        def fail(file, text):
            if file == self.workspace / 'candidate/profile.md': raise OSError('Disk full')
            return real(file, text)
        with patch.object(owner, 'atomic_write', side_effect=fail):
            with self.assertRaises(OSError): owner.persist(self.workspace, profile)
        self.assertEqual((self.workspace / 'candidate/profile.md').read_text(), raw)
        self.assertEqual(load(self.workspace), profile)
        owner.persist(self.workspace, profile)
        self.assertEqual(load(self.workspace), profile)



if __name__ == "__main__":
    unittest.main()

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml
from profile import apply_plan, plan, load, ValidationError
from search_config import FILL, initialize, inspect_config, export, REQUIRED
from test_profile import change, extract, observation, record


class SearchConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name) / 'workspace'
        self.cv = Path(self.temp.name) / 'CV.md'
        self.cv.write_text('Ada Example\nFrontend Engineer\nReact and TypeScript\nWarsaw, Poland\n')
        self.source = extract(self.cv)['source']
        self.changes = change(self.source, [
            record('identity', 'identity', full_name=observation(self.source, 'Ada Example', 'Ada Example'),
                   location=observation(self.source, 'Warsaw, Poland', 'Warsaw, Poland')),
            record('frontend', 'experience', role=observation(self.source, 'Frontend Engineer', 'Frontend Engineer'),
                   technologies=observation(self.source, ['React', 'TypeScript'], 'React and TypeScript'))])
        apply_plan(self.workspace, plan(None, self.changes))
        self.path = self.workspace / 'search-config.yml'

    def tearDown(self):
        self.temp.cleanup()

    def fill_required(self):
        data = yaml.safe_load(self.path.read_text())
        c = data['criteria']
        c.update(titles=['frontend engineer'], target_count=10, seniorities=None,
                 compensation=None, work_arrangements=['remote'])
        c['candidate']['country'] = 'Poland'
        c['technical']['required'] = []
        self.path.write_text('# User comment\n' + yaml.safe_dump(data, sort_keys=False))
        return data

    def cli(self, command):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('profile.py')), command,
                               '--workspace', str(self.workspace)], capture_output=True, text=True)

    def test_template_has_full_contract_with_comments_and_no_guessed_targets(self):
        result = initialize(self.workspace, country='Poland', city='Warsaw')
        self.assertTrue(result['created'])
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual(set(result['missing_fields']), set(REQUIRED) - {'candidate.country'})
        text = self.path.read_text()
        self.assertIn('# CV role examples (not chosen targets): ["Frontend Engineer"]', text)
        self.assertIn('React', text)
        data = yaml.safe_load(text)
        self.assertEqual(data['criteria']['titles'], FILL)
        self.assertEqual(data['criteria']['technical']['required'], FILL)
        self.assertEqual(data['criteria']['candidate']['country'], 'Poland')
        self.assertEqual(set(data['criteria']), {'sources', 'titles', 'target_count', 'candidate', 'seniorities',
                         'compensation', 'work_arrangements', 'office_locations', 'technical', 'vacancy_types',
                         'company_exclusions', 'preferences', 'posting_age_days', 'discovery_budget', 'conversions'})
        with self.assertRaises(ValidationError):
            export(self.workspace)

    def test_export_applies_only_agreed_defaults_and_uses_current_edits(self):
        initialize(self.workspace)
        data = self.fill_required()
        before = self.path.read_bytes()
        c = export(self.workspace)
        self.assertEqual(c['sources'], ['linkedin'])
        self.assertEqual(c['discovery_budget'], 100)
        self.assertEqual(c['conversions'], {})
        self.assertEqual(c['technical'], {'required': [], 'preferred': [], 'excluded': []})
        self.assertEqual(self.path.read_bytes(), before)
        data['criteria']['target_count'] = 2
        self.path.write_text(yaml.safe_dump(data))
        self.assertEqual(export(self.workspace)['discovery_budget'], 20)
        self.assertFalse((self.workspace / 'candidate/profile.json').exists())

    def test_reinit_and_cv_reimport_preserve_user_config_and_comments(self):
        initialize(self.workspace)
        self.fill_required()
        before = self.path.read_bytes(), self.path.stat().st_mtime_ns
        self.assertFalse(initialize(self.workspace, country='different')['created'])
        apply_plan(self.workspace, plan(load(self.workspace), self.changes))
        self.assertEqual(before, (self.path.read_bytes(), self.path.stat().st_mtime_ns))

    def test_explicit_no_restriction_is_not_an_unfinished_decision(self):
        initialize(self.workspace)
        self.fill_required()
        result = inspect_config(self.workspace)
        self.assertEqual(result['outcome'], 'ready')
        self.assertFalse(result['missing_fields'])
        self.assertIsNone(result['criteria']['seniorities'])

    def test_partial_fx_blocks_export_but_wholly_unknown_fx_does_not(self):
        initialize(self.workspace)
        data = self.fill_required()
        data['criteria']['conversions']['fx']['base'] = 'EUR'
        self.path.write_text(yaml.safe_dump(data))
        result = inspect_config(self.workspace)
        self.assertIn('conversions.fx.date', result['missing_fields'])
        with self.assertRaises(ValidationError):
            export(self.workspace)
        data['criteria']['conversions'] = {'hours_per_month': 160, 'fx': {
            'base': 'EUR', 'date': '2026-10-12', 'source': 'test fixture', 'rates': {'EUR': 1, 'PLN': 4}}}
        self.path.write_text(yaml.safe_dump(data))
        self.assertEqual(export(self.workspace)['conversions']['hours_per_month'], '160')

    def test_invalid_or_unsafe_config_never_overwritten(self):
        initialize(self.workspace)
        for text in ('schema_version: 1\nschema_version: 2\n', '!!python/object/apply:os.system ["touch never"]',
                     'schema_version: 1\nprofile_ref: candidate/profile.yaml\ncriteria: &cycle {titles: *cycle}\n'):
            self.path.write_text(text)
            with self.assertRaises((ValidationError, ValueError)):
                initialize(self.workspace)
            self.assertEqual(self.path.read_text(), text)

    def test_existing_invalid_profile_is_not_bypassed(self):
        (self.workspace / 'candidate/profile.yaml').write_text('broken YAML profile')
        with self.assertRaises(ValidationError):
            initialize(self.workspace)
        self.assertFalse(self.path.exists())

    def test_template_without_readable_profile_reports_incomplete(self):
        workspace = Path(self.temp.name) / 'unreadable'
        result = initialize(workspace)
        self.assertEqual(result['profile_status'], 'missing')
        self.assertEqual(result['outcome'], 'partial')
        self.assertTrue((workspace / 'search-config.yml').exists())
        self.assertFalse((workspace / 'candidate').exists())

    def test_contradictory_criteria_rejected_by_existing_search_validator(self):
        initialize(self.workspace)
        data = self.fill_required()
        data['criteria']['technical'] = {'required': ['react'], 'preferred': [], 'excluded': ['react']}
        self.path.write_text(yaml.safe_dump(data))
        result = inspect_config(self.workspace)
        self.assertEqual(result['outcome'], 'partial')
        self.assertIn('both wanted and excluded', result['errors'][0])
        with self.assertRaises(ValidationError):
            export(self.workspace)

    def test_cli_exports_current_profile_and_config_without_persistent_json(self):
        initialized = self.cli('init-search')
        self.assertEqual(initialized.returncode, 0, initialized.stderr)
        self.assertEqual(self.cli('export-search').returncode, 2)
        self.fill_required()
        before = {p.relative_to(self.workspace): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()}
        validation = self.cli('validate-search')
        self.assertEqual(json.loads(validation.stdout)['outcome'], 'ready')
        exported = self.cli('export-search')
        self.assertEqual(exported.returncode, 0, exported.stderr)
        self.assertEqual(json.loads(exported.stdout)['candidate']['country'], 'poland')
        self.assertEqual(before, {p.relative_to(self.workspace): p.read_bytes() for p in self.workspace.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()

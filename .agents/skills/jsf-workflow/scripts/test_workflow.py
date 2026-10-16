from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from jsf_workflow import workflow
from jsf_workflow.modules import candidate, evaluate, vacancies, tracking, applications
from test_search import config, vacancy, snapshot
from jsf_workflow import codex_bridge
import yaml


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'jobs'
        self.cv = self.root / 'CV.md'
        self.cv.write_text('Ada Example. React and TypeScript.')
        source = candidate.extract(self.cv)['source']
        changes = {'schema_version': 1, 'sources': [source], 'records': [
            {'id': 'identity', 'section': 'identity', 'facts': {'full_name': {'value': 'Ada Example', 'evidence': [{'source_id': source['id'], 'page': 1, 'quote': 'Ada Example'}]}}}]}
        candidate.apply_plan(self.workspace, candidate.plan(None, changes))
        self.write_config(config())

    def tearDown(self):
        self.temp.cleanup()

    def write_config(self, criteria):
        (self.workspace / 'search-config.yml').write_text(yaml.safe_dump({'schema_version': 1, 'profile_ref': 'candidate/profile.yaml', 'criteria': criteria}))

    def seed(self, *records):
        result = evaluate.evaluate(config(), snapshot(*records))
        result = vacancies.import_results(vacancies.load(self.workspace), result)
        vacancies.save(self.workspace, result['history'])

    def row(self, identifier='linkedin:1'):
        return next(r for r in workflow.table(self.workspace)['rows'] if r['vacancy_id'] == identifier)

    def edit(self, field, value, **extra):
        row = self.row()
        return workflow.edit_row(self.workspace, row['vacancy_id'], field, value, row['revision'], **extra)

    def test_edits_keep_observations_immutable_and_survive_refresh(self):
        self.seed(vacancy())
        original = vacancies.load(self.workspace)['vacancies']['linkedin:1']['observations']
        self.edit('company', 'My corrected company')
        self.edit('advertised_compensation', 'Employer clarified: 30,000 PLN/month')
        self.seed(vacancy())
        self.assertEqual(self.row()['values']['company'], 'My corrected company')
        self.assertEqual(original, vacancies.load(self.workspace)['vacancies']['linkedin:1']['observations'])
        self.assertIn('company', self.row()['corrected_fields'])
        with self.assertRaises(ValueError):
            self.edit('fit', 'match')

    def test_checkbox_creates_one_application_and_does_not_invent_date_or_salary(self):
        self.seed(vacancy())
        row = self.edit('applied', True)
        app = row['applications'][0]
        self.assertTrue(row['applied'])
        self.assertEqual(app['status'], 'applied')
        self.assertEqual(app['salary'], '')
        self.assertEqual(app['applied_at'], '')
        self.assertEqual(app['vacancy_id'], 'linkedin:1')
        self.edit('applied', True)
        self.assertEqual(len(self.row()['applications']), 1)
        self.edit('applied', False)
        self.assertEqual(self.row()['applications'][0]['status'], 'ready')
        self.assertFalse(self.row()['applied'])

    def test_unknown_work_arrangement_is_allowed_in_checkbox_mode(self):
        raw = vacancy()
        raw['facts'].pop('work_arrangements')
        self.seed(raw)
        row = self.edit('applied', True)
        self.assertEqual(row['applications'][0]['work_type'], '')

    def test_progress_cannot_be_silently_unchecked_and_bad_dates_do_not_write(self):
        self.seed(vacancy())
        self.edit('applied', True)
        self.edit('status', 'interviewing')
        self.edit('next_interview', 'technical')
        self.edit('next_interview_at', '2026-10-20T10:00:00+02:00')
        path = self.workspace / 'applications_table.csv'
        before = path.read_bytes()
        with self.assertRaises(tracking.ConfirmationRequired):
            self.edit('applied', False)
        self.assertEqual(before, path.read_bytes())
        with self.assertRaises(ValueError):
            self.edit('next_interview_at', '2026-10-20T10:00:00')
        self.assertEqual(before, path.read_bytes())
        row = self.edit('applied', False, confirm=True)
        self.assertEqual(row['applications'][0]['next_interview'], 'technical')
        self.assertEqual(row['applications'][0]['status'], 'ready')

    def test_stale_edits_fail_without_overwriting(self):
        self.seed(vacancy())
        old = self.row()
        self.edit('notes', 'Keep this')
        with self.assertRaisesRegex(ValueError, 'changed elsewhere'):
            workflow.edit_row(self.workspace, old['vacancy_id'], 'notes', 'Stale note', old['revision'])
        self.assertEqual(self.row()['values']['notes'], 'Keep this')

    def test_link_correction_cannot_steal_another_vacancys_application(self):
        self.seed(vacancy(), vacancy('2'))
        before = self.row()
        with self.assertRaisesRegex(ValueError, 'another tracked vacancy'):
            self.edit('url', vacancy('2')['url'])
        self.assertEqual(self.row(), before)

    def test_legacy_upgrade_needs_consent_and_keeps_backup(self):
        self.seed(vacancy())
        path = self.workspace / 'applications_table.csv'
        row = dict.fromkeys(applications.COLUMNS, '')
        row.update(application_id='old', company='Example', position='Senior Engineer', status='applied', work_type='remote', vacancy_link=vacancy()['url'])
        applications.write_table(path, applications.COLUMNS, [row])
        before = path.read_bytes()
        self.assertTrue(self.row()['applied'])
        with self.assertRaises(tracking.ConfirmationRequired):
            self.edit('salary', '30,000 PLN/month B2B before VAT')
        self.assertEqual(path.read_bytes(), before)
        self.edit('salary', '30,000 PLN/month B2B before VAT', confirm=True)
        backups = list(self.workspace.glob('*.bak'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)

    def test_identity_bridge_keeps_checkbox_and_user_corrections(self):
        self.seed(vacancy('1'), vacancy('2'))
        self.edit('company', 'Corrected')
        r2 = self.row('linkedin:2')
        workflow.edit_row(self.workspace, 'linkedin:2', 'applied', True, r2['revision'])
        a, b = vacancy('1'), vacancy('2')
        a['application_url'] = b['application_url'] = 'https://ats.example/apply?jobId=1'
        self.seed(a, b)
        self.assertEqual(len(workflow.table(self.workspace)['rows']), 1)
        self.assertTrue(self.row()['applied'])
        self.assertEqual(self.row()['values']['company'], 'Corrected')
        self.edit('applied', False)
        self.assertFalse(self.row()['applied'])

    def test_upgrade_confirmation_also_discloses_hiring_progress_reset(self):
        self.seed(vacancy())
        path = self.workspace / 'applications_table.csv'
        row = dict.fromkeys(applications.COLUMNS, '')
        row.update(application_id='legacy', company='Example', position='Engineer', work_type='remote', status='interviewing', vacancy_link=vacancy()['url'])
        applications.write_table(path, applications.COLUMNS, [row])
        before = path.read_bytes()
        with self.assertRaises(tracking.ConfirmationRequired) as caught:
            self.edit('applied', False)
        self.assertIn('backup', str(caught.exception))
        self.assertIn('hiring progress', str(caught.exception))
        self.assertEqual(path.read_bytes(), before)

    def test_multiple_candidacies_require_selection(self):
        self.seed(vacancy())
        self.edit('applied', True)
        path = self.workspace / 'applications_table.csv'
        columns, rows = applications.read_table(path)
        rows.append({**rows[0], 'application_id': 'second', 'submitted': 'false', 'status': 'ready'})
        applications.write_table(path, columns, rows)
        with self.assertRaisesRegex(ValueError, 'select one'):
            self.edit('salary', 'Updated')
        self.edit('salary', 'Updated', application_id='second')
        self.assertEqual(self.row()['applications'][1]['salary'], 'Updated')
        self.assertEqual(self.row()['applications'][0]['salary'], '')
        self.assertTrue(self.row()['applied'])
        self.assertFalse(self.row()['applied_by_application']['second'])
        self.edit('applied', True, application_id='second')
        self.assertTrue(self.row()['applied_by_application']['second'])

    def test_application_only_records_can_be_explicitly_adopted_and_edited(self):
        path = self.workspace / 'applications_table.csv'
        row = dict.fromkeys(applications.COLUMNS, '')
        row.update(application_id='old', company='Prior Company', position='Engineer', work_type='remote', status='applied', vacancy_link=vacancy()['url'])
        applications.write_table(path, applications.COLUMNS, [row])
        before = path.read_bytes()
        self.assertEqual(len(workflow.table(self.workspace)['unlinked_applications']), 1)
        self.assertFalse((self.workspace / 'vacancies').exists())
        adopted = workflow.adopt_applications(self.workspace)
        self.assertFalse(adopted['unlinked_applications'])
        self.assertEqual(path.read_bytes(), before)
        saved = adopted['rows'][0]
        self.assertTrue(saved['applied'])
        self.assertEqual(saved['fit'], 'unassessed')
        self.assertEqual(saved['availability'], 'uncertain')
        updated = workflow.edit_row(self.workspace, saved['vacancy_id'], 'company', 'Corrected Company', saved['revision'])
        self.assertEqual(updated['values']['company'], 'Corrected Company')
        self.assertEqual(len(workflow.adopt_applications(self.workspace)['rows']), 1)

    def test_new_count_excludes_history_and_submitted_urls_and_continues_acquisition(self):
        self.seed(vacancy('1'))
        path = self.workspace / 'applications_table.csv'
        app = dict.fromkeys(applications.COLUMNS, '')
        app.update(application_id='prior', company='Other', position='Engineer', work_type='remote', status='ready', vacancy_link=vacancy('3')['url'])
        applications.write_table(path, applications.COLUMNS, [app])
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{'title': 'frontend'}]
            def page(self, q, offset): return [vacancy(str(i)) for i in range(1, 5)] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}}
        before = (self.workspace / 'search-config.yml').read_bytes()
        result = workflow.find_jobs(self.workspace, 2, interpreter=lambda c, records, expertise: [vacancy(r['source_id'])['facts'] for r in records], adapters={'linkedin': Adapter}, delay=0)
        self.assertEqual(result['found'], 2)
        self.assertCountEqual(result['vacancy_ids'], ['linkedin:2', 'linkedin:4'])
        self.assertEqual(len(workflow.table(self.workspace)['rows']), 4)
        self.assertEqual((self.workspace / 'search-config.yml').read_bytes(), before)

    def test_find_jobs_saves_results_with_b2b_and_uop_preferences(self):
        c = config()
        c['compensation'].append({'contract': 'uop', 'minimum': 18000, 'currency': 'PLN', 'period': 'month', 'basis': 'gross'})
        self.write_config(c)
        before = (self.workspace / 'search-config.yml').read_bytes()
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [vacancy()] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}}
        result = workflow.find_jobs(self.workspace, 1, interpreter=lambda c, records, expertise: [vacancy()['facts'] for r in records], adapters={'linkedin': Adapter}, delay=0)
        self.assertEqual(result['found'], 1)
        self.assertEqual(result['vacancy_ids'], ['linkedin:1'])
        self.assertEqual(self.row()['fit'], 'match')
        self.assertEqual((self.workspace / 'search-config.yml').read_bytes(), before)

    def test_ten_jobs_stops_at_target_or_inspection_limit_and_reports_both(self):
        for qualifying in (True, False):
            with self.subTest(qualifying=qualifying):
                c = config()
                c['discovery_budget'] = 12
                self.write_config(c)
                inspected, messages = [], []
                class Adapter:
                    page_size = 25
                    def __init__(self, delay=0): pass
                    def queries(self, c): return [{}]
                    def page(self, q, offset): return [vacancy(str(i)) for i in range(offset + 1, offset + 26)]
                    def detail(self, v):
                        inspected.append(v['source_id'])
                        return {**v, 'facts': {}}
                def interpret(c, records, expertise):
                    return [vacancy()['facts'] if qualifying else {} for r in records]
                result = workflow.find_jobs(self.workspace, 10, progress=messages.append, interpreter=interpret, adapters={'linkedin': Adapter}, delay=0)
                self.assertEqual(result['found'], 10 if qualifying else 0)
                self.assertEqual(len(inspected), 10 if qualifying else 12)
                self.assertEqual(result['coverage']['stopping_reason'], 'target_met' if qualifying else 'discovery_budget')
                self.assertTrue(all('of 10' in message and '12' in message for message in messages), messages)

    def test_removed_vacancy_is_rediscovered_with_application_status_preserved(self):
        self.seed(vacancy())
        self.edit('status', 'applied')
        before = (self.workspace / 'applications_table.csv').read_bytes()
        row = self.row()
        workflow.remove_row(self.workspace, row['vacancy_id'], row['revision'])
        self.assertFalse(workflow.table(self.workspace)['rows'])
        self.assertEqual((self.workspace / 'applications_table.csv').read_bytes(), before)
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [vacancy()] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}}
        result = workflow.find_jobs(self.workspace, 1, interpreter=lambda c, records, expertise: [vacancy()['facts'] for r in records], adapters={'linkedin': Adapter}, delay=0)
        self.assertEqual(result['found'], 1)
        self.assertTrue(self.row()['applied'])
        self.assertEqual((self.workspace / 'applications_table.csv').read_bytes(), before)

    def test_manual_recreation_relinks_old_application_without_duplicate_or_overwrite(self):
        self.seed(vacancy())
        self.edit('status', 'interviewing')
        old = self.row()
        self.edit('notes', 'Changed elsewhere')
        with self.assertRaises(ValueError): workflow.remove_row(self.workspace, old['vacancy_id'], old['revision'])
        row = self.row()
        workflow.remove_row(self.workspace, row['vacancy_id'], row['revision'])
        created = workflow.add_row(self.workspace, {'company': 'Referral', 'title': 'Engineer', 'url': vacancy()['url']})
        self.assertTrue(created['created'])
        self.assertTrue(created['row']['applied'])
        self.assertEqual(created['row']['applications'][0]['status'], 'interviewing')
        again = workflow.add_row(self.workspace, {'company': 'Wrong', 'title': 'Wrong', 'url': vacancy()['url']})
        self.assertFalse(again['created'])
        self.assertEqual(again['row']['values']['company'], 'Referral')

    def test_bulk_remove_checks_application_revisions_and_preserves_all_applications(self):
        self.seed(vacancy(), vacancy('2'), vacancy('3'))
        rows = workflow.table(self.workspace)['rows'][:2]
        selections = [{'vacancy_id': r['vacancy_id'], 'revision': r['revision']} for r in rows]
        workflow.edit_row(self.workspace, rows[1]['vacancy_id'], 'status', 'interviewing', rows[1]['revision'])
        history_path = self.workspace / 'vacancies/history.json'
        before = history_path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Nothing removed'):
            workflow.remove_rows(self.workspace, selections)
        self.assertEqual(history_path.read_bytes(), before)
        self.assertEqual(len(workflow.table(self.workspace)['rows']), 3)
        rows = workflow.table(self.workspace)['rows'][:2]
        selections = [{'vacancy_id': r['vacancy_id'], 'revision': r['revision']} for r in rows]
        applications_before = (self.workspace / 'applications_table.csv').read_bytes()
        removed = workflow.remove_rows(self.workspace, selections)
        self.assertEqual(len(removed['removed']), 2)
        self.assertEqual([r['vacancy_id'] for r in workflow.table(self.workspace)['rows']], ['linkedin:3'])
        self.assertEqual((self.workspace / 'applications_table.csv').read_bytes(), applications_before)

    def test_budget_shortfall_and_invalid_ai_evidence(self):
        c = config(); c.update(target_count=1, discovery_budget=1)
        self.write_config(c)
        self.seed(vacancy())
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [vacancy()]
            def detail(self, v): return {**v, 'facts': {}}
        result = workflow.find_jobs(self.workspace, 2, interpreter=lambda c, records, expertise: [vacancy()['facts']], adapters={'linkedin': Adapter}, delay=0)
        self.assertEqual(result['requested'], 2)
        self.assertEqual(result['shortfall'], 2)
        self.assertEqual(result['coverage']['stopping_reason'], 'discovery_budget')
        before = (self.workspace / 'vacancies/history.json').read_bytes()
        bad = vacancy()['facts']; bad['role_titles']['evidence'][0]['quote'] = 'Invented evidence'
        with self.assertRaises(ValueError):
            workflow.find_jobs(self.workspace, 1, interpreter=lambda c, records, expertise: [bad], adapters={'linkedin': Adapter}, delay=0)
        self.assertEqual((self.workspace / 'vacancies/history.json').read_bytes(), before)

    def test_codex_does_not_fall_back_to_api_key_billing(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test', 'CODEX_API_KEY': 'test'}):
            self.assertNotIn('OPENAI_API_KEY', codex_bridge.environment())
            self.assertNotIn('CODEX_API_KEY', codex_bridge.environment())
        with patch('jsf_workflow.codex_bridge.shutil.which', return_value=None):
            self.assertFalse(codex_bridge.status()['ready'])


if __name__ == '__main__':
    unittest.main()

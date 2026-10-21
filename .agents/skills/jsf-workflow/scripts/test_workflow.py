import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from jsf_workflow import workflow
from jsf_workflow.modules import candidate, evaluate, vacancies, tracking, applications
from test_search import config, vacancy, snapshot
from jsf_workflow import ai, claude_bridge, codex_bridge
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
        self.assertEqual(len(workflow.table(self.workspace)['rows']), 3)
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

    def test_ai_limit_defers_unsaved_listings_and_reports_usage(self):
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [vacancy(str(i)) for i in range(1, 11)] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}, 'description': v['description'] + ' Reference ' + v['source_id']}
        calls = []
        def interpret(c, records, expertise):
            calls.append(len(records))
            return {'schema_version': 1, 'facts': [vacancy()['facts'] for r in records], 'usage': {'input_tokens': 100, 'output_tokens': 20}, 'prompt_characters': 300}
        result = workflow.find_jobs(self.workspace, 10, interpreter=interpret, adapters={'linkedin': Adapter}, delay=0, max_ai_calls=1, cache_version='fixture-v1')
        self.assertEqual(calls, [5])
        self.assertEqual(result['found'], 5)
        self.assertEqual(result['coverage']['stopping_reason'], 'ai_limit')
        self.assertEqual(result['ai_usage']['deferred'], 5)
        self.assertEqual(result['ai_usage']['reported_tokens']['input_tokens'], 100)
        self.assertEqual(len(workflow.table(self.workspace)['rows']), 5)
        reused = workflow.find_jobs(self.workspace, 10, interpreter=interpret, adapters={'linkedin': Adapter}, delay=0, max_ai_calls=0, cache_version='fixture-v1')
        self.assertEqual(calls, [5])
        self.assertEqual(reused['ai_usage']['reused'], 5)
        self.assertEqual(reused['found'], 0)  # Tracked matches are never new again.
        self.assertEqual(reused['ai_usage']['deferred'], 5)

    def test_identical_evidence_reuses_facts_and_pay_changes_recheck_without_ai(self):
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [vacancy(str(i)) for i in range(1, 11)] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}}
        calls = []
        def interpret(c, records, expertise):
            calls.append(len(records)); return [vacancy()['facts'] for r in records]
        first = workflow.find_jobs(self.workspace, 10, interpreter=interpret, adapters={'linkedin': Adapter}, delay=0, max_ai_calls=1, cache_version='fixture-v1')
        self.assertEqual(first['found'], 10)
        self.assertEqual(calls, [5])
        self.assertEqual(first['ai_usage']['reused'], 5)
        c = config(); c['compensation'][0]['minimum'] = 30000; self.write_config(c)
        second = workflow.find_jobs(self.workspace, 1, interpreter=interpret, adapters={'linkedin': Adapter}, delay=0, max_ai_calls=0, cache_version='fixture-v1')
        self.assertEqual(calls, [5])
        self.assertGreater(second['ai_usage']['reused'], 0)
        self.assertEqual(self.row()['fit'], 'rejected')

    def test_scripted_rejections_and_zero_allowance_make_no_ai_calls(self):
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [{**vacancy(), 'active': False}] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}}
        def never(*args): raise AssertionError('AI must not be called')
        result = workflow.find_jobs(self.workspace, 1, interpreter=never, adapters={'linkedin': Adapter}, delay=0, max_ai_calls=0)
        self.assertEqual(result['ai_usage']['ai_calls'], 0)
        self.assertEqual(result['ai_usage']['scripted'], 1)
        self.assertEqual(self.row()['fit'], 'rejected')

    def test_interpreter_can_clear_a_contradicted_script_fact(self):
        class Adapter:
            page_size = 10
            def __init__(self, delay=0): pass
            def queries(self, c): return [{}]
            def page(self, q, offset): return [vacancy()] if offset == 0 else []
            def detail(self, v): return {**v, 'facts': {}, 'description': 'Required skills: React, TypeScript\n' + v['description']}
        def interpret(c, records, expertise):
            self.assertTrue(records[0]['facts']['technical']['react']['value'])
            facts = vacancy()['facts']
            facts['technical']['react'] = None
            return [facts]
        result = workflow.find_jobs(self.workspace, 1, interpreter=interpret, adapters={'linkedin': Adapter}, delay=0)
        self.assertEqual(result['found'], 0)
        self.assertEqual(self.row()['fit'], 'needs_clarification')

    def test_bridge_prompt_and_json_usage_are_compact_and_no_profile_evidence_is_sent(self):
        from types import SimpleNamespace
        prompt = codex_bridge.annotation_prompt(evaluate.criteria(config()), [vacancy()])
        self.assertLess(len(prompt), 6000)
        self.assertNotIn('Candidate profile', prompt)
        self.assertEqual(codex_bridge.token_usage('not json'), None)
        self.assertEqual(codex_bridge.token_usage('{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":4,"output_tokens":2}}')['input_tokens'], 12)
        def fake_run(command, **kwargs):
            self.assertIn('--json', command)
            self.assertNotIn('private-profile-evidence', kwargs['input'])
            output = Path(command[command.index('--output-last-message') + 1])
            output.write_text(json.dumps({'annotations': [{'index': 0, 'facts_json': json.dumps(vacancy()['facts'])}]}))
            return SimpleNamespace(returncode=0, stdout='{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":2}}')
        with patch.object(codex_bridge, 'status', return_value={'ready': True}), patch.object(codex_bridge.subprocess, 'run', side_effect=fake_run):
            result = codex_bridge.interpret_batch(evaluate.criteria(config()), [vacancy()], {'private-profile-evidence': True})
        self.assertEqual(result['usage']['input_tokens'], 12)
        self.assertEqual(result['facts'], [vacancy()['facts']])

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
        class NewAdapter(Adapter):
            def page(self, q, offset): return [vacancy('2')] if offset == 0 else []
        with self.assertRaises(ValueError):
            workflow.find_jobs(self.workspace, 1, interpreter=lambda c, records, expertise: [bad], adapters={'linkedin': NewAdapter}, delay=0)
        self.assertEqual((self.workspace / 'vacancies/history.json').read_bytes(), before)

    def test_codex_does_not_fall_back_to_api_key_billing(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test', 'CODEX_API_KEY': 'test'}):
            self.assertNotIn('OPENAI_API_KEY', codex_bridge.environment())
            self.assertNotIn('CODEX_API_KEY', codex_bridge.environment())
        with patch('jsf_workflow.codex_bridge.shutil.which', return_value=None):
            self.assertFalse(codex_bridge.status()['ready'])

    def test_claude_bridge_uses_structured_output_without_tools_or_api_billing(self):
        from types import SimpleNamespace
        def fake_run(command, **kwargs):
            self.assertEqual(command[:2], ['claude', '-p'])
            self.assertEqual(command[command.index('--tools') + 1], '')
            self.assertEqual(command[command.index('--setting-sources') + 1], '')
            self.assertIn('--no-session-persistence', command)
            self.assertNotIn('ANTHROPIC_API_KEY', kwargs['env'])
            self.assertNotIn('CLAUDE_CODE_USE_BEDROCK', kwargs['env'])
            self.assertNotIn('private-profile-evidence', kwargs['input'])
            return SimpleNamespace(returncode=0, stdout=json.dumps({'type': 'result', 'is_error': False, 'usage': {'input_tokens': 12, 'output_tokens': 2, 'service_tier': 'standard'},
                                                                    'structured_output': {'annotations': [{'index': 0, 'facts_json': json.dumps(vacancy()['facts'])}]}}))
        with patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test', 'CLAUDE_CODE_USE_BEDROCK': '1', 'JSF_CLAUDE_AUTH': ''}), patch.object(claude_bridge, 'status', return_value={'ready': True}), patch.object(claude_bridge.subprocess, 'run', side_effect=fake_run):
            result = claude_bridge.interpret_batch(evaluate.criteria(config()), [vacancy()], {'private-profile-evidence': True})
        self.assertEqual(result['facts'], [vacancy()['facts']])
        self.assertEqual(result['usage'], {'input_tokens': 12, 'output_tokens': 2})
        declined = SimpleNamespace(returncode=0, stdout=json.dumps({'type': 'result', 'is_error': False, 'result': 'No'}))
        incomplete = SimpleNamespace(returncode=0, stdout=json.dumps({'structured_output': {'annotations': []}}))
        for run in (declined, incomplete, SimpleNamespace(returncode=1, stdout='')):
            with patch.object(claude_bridge, 'status', return_value={'ready': True}), patch.object(claude_bridge.subprocess, 'run', return_value=run):
                with self.assertRaises(ValueError):
                    claude_bridge.interpret_batch(evaluate.criteria(config()), [vacancy()])

    def test_claude_search_model_applies_to_annotation_only(self):
        from jsf_workflow import bridge_common
        with patch.dict('os.environ', {'JSF_SEARCH_MODEL': 'sonnet'}):
            commands = []
            def fake_run(command, **kwargs):
                commands.append(command)
                from types import SimpleNamespace
                return SimpleNamespace(returncode=0, stdout=json.dumps({'structured_output': {'annotations': [{'index': 0, 'facts_json': json.dumps(vacancy()['facts'])}]}}))
            with patch.object(claude_bridge, 'status', return_value={'ready': True}), patch.object(claude_bridge.subprocess, 'run', side_effect=fake_run):
                claude_bridge.interpret_batch(evaluate.criteria(config()), [vacancy()])
            self.assertEqual(commands[0][commands[0].index('--model') + 1], 'sonnet')
            with patch.object(claude_bridge, 'status', return_value={'ready': True}), patch.object(claude_bridge, 'run_cancellable', return_value=(0, json.dumps({'structured_output': {'message': 'ok', 'questions': [], 'changes_json': '{}'}}))) as guided:
                claude_bridge.guided_profile('Fictional CV')
            self.assertNotIn('--model', guided.call_args[0][0])

    def test_claude_status_accepts_only_subscription_logins(self):
        from types import SimpleNamespace
        def state(**fields):
            return SimpleNamespace(returncode=0, stdout=json.dumps(fields), stderr='')
        with patch('jsf_workflow.claude_bridge.shutil.which', return_value='/bin/claude'), patch.dict('os.environ', {'JSF_CLAUDE_AUTH': ''}):
            for method, ready in [('claude.ai', True), ('oauth_token', True), ('api_key', False), ('third_party', False), ('none', False)]:
                with patch.object(claude_bridge.subprocess, 'run', return_value=state(loggedIn=method != 'none', authMethod=method)):
                    self.assertEqual(claude_bridge.status()['ready'], ready, method)
            with patch.object(claude_bridge.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='oops', stderr='')):
                self.assertFalse(claude_bridge.status()['ready'])
        with patch('jsf_workflow.claude_bridge.shutil.which', return_value=None):
            self.assertFalse(claude_bridge.status()['ready'])

    def test_claude_bedrock_is_explicit_opt_in_and_keeps_only_the_bedrock_switch(self):
        from types import SimpleNamespace
        def state(**fields):
            return SimpleNamespace(returncode=0, stdout=json.dumps(fields), stderr='')
        bedrock = state(loggedIn=True, authMethod='third_party', apiProvider='bedrock')
        aws = {'CLAUDE_CODE_USE_BEDROCK': '1', 'AWS_PROFILE': 'example', 'AWS_REGION': 'us-west-2', 'ANTHROPIC_API_KEY': 'test'}
        with patch('jsf_workflow.claude_bridge.shutil.which', return_value='/bin/claude'):
            with patch.dict('os.environ', {**aws, 'JSF_CLAUDE_AUTH': ''}), patch.object(claude_bridge.subprocess, 'run', return_value=bedrock):
                self.assertFalse(claude_bridge.status()['ready'])
                self.assertNotIn('CLAUDE_CODE_USE_BEDROCK', claude_bridge.environment())
            with patch.dict('os.environ', {**aws, 'JSF_CLAUDE_AUTH': 'bedrock'}), patch.object(claude_bridge.subprocess, 'run', return_value=bedrock):
                self.assertTrue(claude_bridge.status()['ready'])
                env = claude_bridge.environment()
                self.assertEqual((env['CLAUDE_CODE_USE_BEDROCK'], env['AWS_PROFILE']), ('1', 'example'))
                self.assertNotIn('ANTHROPIC_API_KEY', env)
                self.assertIn(':bedrock:', claude_bridge.cache_version())
            with patch.dict('os.environ', {**aws, 'JSF_CLAUDE_AUTH': 'bedrock'}), patch.object(claude_bridge.subprocess, 'run', return_value=state(loggedIn=True, authMethod='claude.ai')):
                self.assertFalse(claude_bridge.status()['ready'])
            with patch.dict('os.environ', {'JSF_CLAUDE_AUTH': 'bedrock', 'CLAUDE_CODE_USE_BEDROCK': ''}):
                self.assertIn('CLAUDE_CODE_USE_BEDROCK=1', claude_bridge.status()['message'])
            with patch.dict('os.environ', {'JSF_CLAUDE_AUTH': 'vertex'}):
                self.assertFalse(claude_bridge.status()['ready'])

    def test_ai_provider_selection_is_explicit_or_first_installed(self):
        with patch.dict('os.environ', {'JSF_AI_PROVIDER': 'claude'}):
            self.assertIs(ai.bridge(), claude_bridge)
        with patch.dict('os.environ', {'JSF_AI_PROVIDER': 'gemini'}):
            self.assertFalse(ai.status()['ready'])
            self.assertIn('codex', ai.status()['message'])
        with patch.dict('os.environ', {'JSF_AI_PROVIDER': ''}):
            with patch('jsf_workflow.ai.shutil.which', side_effect=lambda cli: '/bin/claude' if cli == 'claude' else None):
                self.assertIs(ai.bridge(), claude_bridge)
            with patch('jsf_workflow.ai.shutil.which', return_value='/bin/cli'):
                self.assertIs(ai.bridge(), codex_bridge)
            with patch('jsf_workflow.ai.shutil.which', return_value=None):
                self.assertIs(ai.bridge(), codex_bridge)
        with patch.dict('os.environ', {'JSF_AI_PROVIDER': 'claude'}), patch.object(claude_bridge, 'status', return_value={'ready': True, 'message': 'ok'}):
            self.assertEqual(ai.status()['label'], 'Claude Code')
            self.assertNotEqual(claude_bridge.cache_version(), codex_bridge.cache_version())


if __name__ == '__main__':
    unittest.main()

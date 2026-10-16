import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

import server
import test_workflow as fixtures


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.WorkflowTests()
        self.fixture.setUp()
        self.fixture.seed(fixtures.vacancy())
        self.workspace = str(self.fixture.workspace)
        self.server = server.LocalServer(('127.0.0.1', 0))
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.fixture.tearDown()

    def request(self, path, payload=None, token=True, origin=None, host=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {}
        if payload is not None:
            headers.update({'Content-Type': 'application/json', 'X-JSF-Token': self.server.token if token else 'invalid'})
        if origin:
            headers['Origin'] = origin
        if host:
            headers['Host'] = host
        connection.request('POST' if payload is not None else 'GET', path, json.dumps(payload) if payload is not None else None, headers)
        response = connection.getresponse()
        body = response.read()
        status = response.status
        connection.close()
        return status, json.loads(body) if body.startswith(b'{') else body.decode()

    def edit(self, **changes):
        row = self.fixture.row()
        return {'workspace': self.workspace, 'vacancy_id': row['vacancy_id'], 'revision': row['revision'], 'field': 'applied', 'value': True, **changes}

    def test_static_and_workspace_routes(self):
        status, html = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn(self.server.token, html)
        self.assertNotIn('__SESSION_TOKEN__', html)
        self.assertEqual(self.request('/app.js')[0], 200)
        from urllib.parse import quote
        status, data = self.request('/api/workspace?path=' + quote(self.workspace))
        self.assertEqual(status, 200)
        self.assertEqual(data['config']['outcome'], 'ready')
        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(self.request('/../../.git/config')[0], 404)

    def test_requests_require_local_host_and_valid_write_token(self):
        before = self.fixture.row()
        self.assertEqual(self.request('/', host='attacker.example')[0], 403)
        self.assertEqual(self.request('/api/edit', self.edit(), token=False)[0], 403)
        self.assertEqual(self.request('/api/edit', self.edit(), origin='https://attacker.example')[0], 403)
        self.assertEqual(self.fixture.row(), before)

    def test_explicit_application_import_route_preserves_the_tracker(self):
        from jsf_workflow.modules import applications
        path = self.fixture.workspace / 'applications_table.csv'
        record = dict.fromkeys(applications.COLUMNS, '')
        record.update(application_id='old', company='Existing Company', position='Engineer', work_type='remote', status='applied', vacancy_link=fixtures.vacancy('2')['url'])
        applications.write_table(path, applications.COLUMNS, [record])
        before = path.read_bytes()
        status, result = self.request('/api/adopt-applications', {'workspace': self.workspace})
        self.assertEqual(status, 200)
        self.assertEqual(len(result['rows']), 2)
        self.assertFalse(result['unlinked_applications'])
        self.assertEqual(path.read_bytes(), before)

    def test_checkbox_round_trip_and_stale_write(self):
        request = self.edit()
        status, response = self.request('/api/edit', request)
        self.assertEqual(status, 200)
        self.assertTrue(response['row']['applied'])
        self.assertEqual(response['row']['applications'][0]['applied_at'], '')
        self.assertEqual(self.request('/api/edit', request)[0], 400)
        status, response = self.request('/api/edit', self.edit(value=False))
        self.assertEqual(status, 200)
        self.assertFalse(response['row']['applied'])

    def test_failed_writes_are_errors_and_leave_history_unchanged(self):
        before = self.fixture.row()
        with patch('server.workflow.vacancies.save', side_effect=OSError('Disk unavailable')):
            status, response = self.request('/api/edit', self.edit(field='notes', value='Keep draft'))
        self.assertEqual(status, 400)
        self.assertIn('Disk unavailable', response['error'])
        self.assertEqual(self.fixture.row(), before)

    def test_readonly_fit_and_invalid_dates_cannot_be_saved(self):
        self.assertEqual(self.request('/api/edit', self.edit(field='fit', value='match'))[0], 400)
        self.request('/api/edit', self.edit())
        status, _ = self.request('/api/edit', self.edit(field='applied_at', value='2026-02-30'))
        self.assertEqual(status, 400)
        self.assertEqual(self.fixture.row()['applications'][0]['applied_at'], '')

    def test_search_is_async_and_serialized_per_workspace(self):
        started, release = threading.Event(), threading.Event()
        def fake_search(workspace, count, progress):
            started.set()
            release.wait(3)
            return {'requested': count, 'found': 0, 'shortfall': count}
        with patch('server.codex_bridge.status', return_value={'ready': True}), patch('server.workflow.find_jobs', side_effect=fake_search):
            status, _ = self.request('/api/find', {'workspace': self.workspace, 'count': 2})
            self.assertEqual(status, 202)
            self.assertTrue(started.wait(1))
            self.assertEqual(self.request('/api/find', {'workspace': self.workspace, 'count': 2})[0], 409)
            # Edits remain available while acquisition/AI are in progress.
            self.assertEqual(self.request('/api/edit', self.edit(field='notes', value='During search'))[0], 200)
            release.set()

    def test_missing_codex_blocks_search_without_side_effects(self):
        with patch('server.codex_bridge.status', return_value={'ready': False, 'message': 'Sign in first'}):
            status, response = self.request('/api/find', {'workspace': self.workspace, 'count': 2})
        self.assertEqual(status, 400)
        self.assertEqual(response['error'], 'Sign in first')
        self.assertFalse(self.server.jobs)

    def readiness(self, path=None):
        from urllib.parse import quote
        with patch('server.codex_bridge.status', return_value={'ready': True, 'message': 'ChatGPT login detected'}):
            status, result = self.request('/api/readiness?path=' + quote(self.workspace if path is None else path))
        self.assertEqual(status, 200)
        return result

    def test_readiness_allows_partial_profile_and_reads_current_config(self):
        import yaml
        from jsf_profile import profile as candidate
        profile = candidate.load(self.fixture.workspace)
        profile['issues'].append('Some experience details are unknown')
        candidate.persist(self.fixture.workspace, profile)
        result = self.readiness()
        self.assertTrue(result['ready'])
        self.assertEqual(next(c for c in result['checks'] if c['key'] == 'profile')['state'], 'warning')
        config = self.fixture.workspace / 'search-config.yml'
        content = yaml.safe_load(config.read_text())
        content['criteria']['titles'] = '__FILL_ME__'
        config.write_text(yaml.safe_dump(content))
        result = self.readiness()
        self.assertFalse(result['ready'])
        check = next(c for c in result['checks'] if c['key'] == 'config')
        self.assertIn('titles', check['message'])
        self.assertIn(self.workspace, check['request'])

    def test_readiness_missing_workspace_and_profile_are_explained(self):
        checks = self.readiness('')['checks']
        self.assertEqual([c['key'] for c in checks], ['workspace','codex','profile','config'])
        self.assertTrue(all(c['state']=='pending' for c in checks if c['key']!='codex'))
        self.assertEqual(self.readiness(self.workspace + '/absent')['checks'][0]['state'], 'blocked')
        (self.fixture.workspace / 'candidate/profile.md').unlink()
        check = next(c for c in self.readiness()['checks'] if c['key']=='profile')
        self.assertEqual(check['state'], 'blocked')
        self.assertIn('missing', check['message'])
        self.assertIn('CV', check['request'])

    def test_readiness_survives_corrupt_tracker_and_rechecks_codex(self):
        (self.fixture.workspace / 'applications_table.csv').write_text('broken')
        self.assertTrue(self.readiness()['ready'])
        with patch('server.codex_bridge.status', return_value={'ready': False, 'message': 'Sign in first'}):
            status, result = self.request('/api/readiness?path=' + self.workspace)
        self.assertEqual(status, 200)
        self.assertFalse(result['ready'])
        self.assertEqual(next(c for c in result['checks'] if c['key']=='codex')['message'], 'Sign in first')

    def test_guided_preferences_require_token_and_keep_drafts_separate(self):
        payload = {'workspace': self.workspace, 'kind': 'config'}
        self.assertEqual(self.request('/api/setup/start', payload, token=False)[0], 403)
        status, result = self.request('/api/setup/start', payload)
        self.assertEqual(status, 200)
        session = result['session']
        self.assertEqual(session['state'], 'questions')
        from urllib.parse import quote
        current = self.request('/api/setup?path=' + quote(self.workspace))[1]['session']
        self.assertEqual(current, session)
        before = (self.fixture.workspace / 'search-config.yml').read_bytes()
        self.assertEqual(self.request('/api/setup/save', {'workspace': self.workspace, 'id': session['id'], 'revision': session['revision']})[0], 400)
        status, result = self.request('/api/setup/cancel', {'workspace': self.workspace, 'id': session['id'], 'revision': session['revision']})
        self.assertEqual(status, 200)
        self.assertEqual(result['session']['state'], 'cancelled')
        self.assertEqual((self.fixture.workspace / 'search-config.yml').read_bytes(), before)
        self.assertEqual(self.request('/setup.js')[0], 200)

    def test_profile_warning_explains_missing_proficiency_without_blocking_search(self):
        from jsf_workflow.modules import candidate
        profile = candidate.load(self.fixture.workspace)
        source = next(iter(profile['sources'].values()))
        proposal = candidate.plan(profile, {'schema_version': 1, 'sources': [], 'records': [
            {'id': 'react', 'section': 'skills', 'facts': {'name': {'value': 'React', 'evidence': [
                {'source_id': source['id'], 'page': 1, 'quote': 'React'}]}}}]})
        candidate.apply_plan(self.fixture.workspace, proposal)
        result = self.readiness()
        check = next(c for c in result['checks'] if c['key'] == 'profile')
        self.assertTrue(result['ready'])
        self.assertEqual(check['state'], 'warning')
        self.assertIn('1 missing detail', check['message'])
        self.assertIn('do not block searching', check['message'])
        self.assertEqual(check['details'], ['React: proficiency level not specified'])

    def test_workspace_picker_requires_local_authorization_and_handles_cancel(self):
        with patch('server.folders.select',return_value=self.workspace) as picker:
            self.assertEqual(self.request('/api/select-workspace',{},token=False)[0],403)
            self.assertEqual(self.request('/api/select-workspace',{},origin='https://foreign.example')[0],403)
            picker.assert_not_called()
            self.assertEqual(self.request('/api/select-workspace',{}),(200,{'workspace':self.workspace}))
        with patch('server.folders.select',return_value=None):
            self.assertEqual(self.request('/api/select-workspace',{}),(200,{'workspace':None}))
        with patch('server.folders.select',side_effect=ValueError('Picker unavailable')):
            self.assertEqual(self.request('/api/select-workspace',{})[0],400)

    def test_saved_profile_edit_and_independent_preferences_without_codex(self):
        with patch('server.codex_bridge.guided_profile',side_effect=AssertionError('No AI for manual edits')):
            _,profile=self.request('/api/setup/start',{'workspace':self.workspace,'kind':'profile'})
            session=profile['session'];self.assertEqual(session['state'],'review')
            _,config=self.request('/api/setup/start',{'workspace':self.workspace,'kind':'config'})
            self.assertEqual(config['session']['state'],'questions')
            _,resumed=self.request('/api/setup?path='+self.workspace+'&kind=profile')
            self.assertEqual(resumed['session']['id'],session['id'])
            edited=session['review'].replace('**Full Name:** Ada Example','**Full Name:** Ada Updated')
            status,saved=self.request('/api/setup/save',{'workspace':self.workspace,'id':session['id'],'revision':session['revision'],'text':edited})
            self.assertEqual(status,200,saved)
            self.assertEqual(saved['session']['state'],'complete')



if __name__ == '__main__':
    unittest.main()

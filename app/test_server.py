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
        from modules import applications
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


if __name__ == '__main__':
    unittest.main()

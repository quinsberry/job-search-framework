"""Local job-search UI. Run: python3 app/server.py [--workspace /your/workspace] [--ai-provider codex|claude] [--claude-auth subscription|bedrock]."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import sys
import threading
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.agents/skills/jsf-workflow/scripts'))
from jsf_workflow import workflow, ai, claude_bridge, setup_sessions
from jsf_workflow.modules import candidate, search_config, tracking
import readiness
import folders


STATIC = Path(__file__).with_name('static')


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workspace=''):
        super().__init__(address, Handler)
        self.token = secrets.token_urlsafe(32)
        self.initial_workspace = workspace
        self.jobs = {}
        self.job_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Do not put workspace paths or job content into request logs.

    def send(self, code, body, kind='application/json'):
        data = json.dumps(body, ensure_ascii=False).encode() if kind == 'application/json' else body
        self.send_response(code)
        self.send_header('Content-Type', kind + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'")
        self.end_headers()
        self.wfile.write(data)

    def local_host(self):
        host = urlsplit('http://' + self.headers.get('Host', '')).hostname
        return host in {'localhost', '127.0.0.1', '::1'}

    def do_GET(self):
        try:
            if not self.local_host():
                return self.send(403, {'error': 'Local connections only'})
            url = urlsplit(self.path)
            if url.path == '/':
                content = (STATIC / 'index.html').read_text().replace('__SESSION_TOKEN__', self.server.token)
                return self.send(200, content.encode(), 'text/html')
            if url.path in {'/app.js', '/setup.js', '/style.css'}:
                return self.send(200, (STATIC / url.path[1:]).read_bytes(), 'text/javascript' if url.path.endswith('.js') else 'text/css')
            if url.path == '/api/session':
                return self.send(200, {'workspace': self.server.initial_workspace, 'ai': ai.status()})
            if url.path == '/api/readiness':
                return self.send(200, readiness.inspect(parse_qs(url.query).get('path', [''])[0]))
            if url.path == '/api/profile-template':
                return self.send(200, candidate.template_help())
            if url.path == '/api/setup':
                workspace = workflow.workspace_path(parse_qs(url.query).get('path', [''])[0])
                kind = parse_qs(url.query).get('kind', [None])[0]
                return self.send(200, {'session': setup_sessions.current(workspace, kind),
                                      'sessions': [setup_sessions.current(workspace, k) for k in ('profile', 'config')]})
            if url.path == '/api/workspace':
                workspace = workflow.workspace_path(parse_qs(url.query).get('path', [''])[0])
                data = workflow.table(workspace)
                try:
                    data['config'] = search_config.inspect_config(workspace)
                except (ValueError, OSError) as exc:
                    data['config'] = {'outcome': 'partial', 'errors': [str(exc)], 'missing_fields': []}
                data['job'] = self.server.jobs.get(str(workspace))
                return self.send(200, data)
            return self.send(404, {'error': 'Not found'})
        except (ValueError, OSError, KeyError, TypeError) as exc:
            return self.send(400, {'error': str(exc)})

    def do_POST(self):
        try:
            if not self.local_host() or not secrets.compare_digest(self.headers.get('X-JSF-Token', ''), self.server.token):
                return self.send(403, {'error': 'Invalid local session. Reload this page.'})
            origin = self.headers.get('Origin')
            if origin and origin != 'http://' + self.headers.get('Host'):
                return self.send(403, {'error': 'Cross-origin writes are disabled'})
            size = int(self.headers.get('Content-Length', 0))
            limit = 15000000 if self.path == '/api/setup/source' else 1000000
            if size < 1 or size > limit or self.headers.get_content_type() != 'application/json':
                return self.send(400, {'error': 'Request too large or invalid JSON content type'})
            data = json.loads(self.rfile.read(size))
            if self.path == '/api/select-workspace':
                return self.send(200, {'workspace': folders.select()})
            workspace = workflow.workspace_path(data['workspace'])
            if self.path == '/api/setup/start':
                return self.send(200, {'session': setup_sessions.start(workspace, data['kind'])})
            if self.path.startswith('/api/setup/'):
                action = self.path.rsplit('/', 1)[1]
                args = (workspace, data['id'], data['revision'])
                if action == 'source':
                    session = setup_sessions.choose_source(*args, source_id=data.get('source_id'), upload=data.get('upload'))
                elif action == 'answer':
                    session = setup_sessions.answer(*args, data['answers'])
                elif action == 'markdown':
                    session = setup_sessions.markdown(*args, data['text'])
                elif action == 'save':
                    session = setup_sessions.save(*args, text=data.get('text'))
                elif action in {'retry', 'edit', 'rebase', 'back', 'cancel', 'import_cv'}:
                    session = getattr(setup_sessions, action)(*args)
                else:
                    return self.send(404, {'error': 'Unknown setup action'})
                return self.send(200, {'session': session})
            if self.path == '/api/edit':
                row = workflow.edit_row(workspace, data['vacancy_id'], data['field'], data['value'],
                                        data['revision'], data.get('application_id'), data.get('confirm') is True)
                return self.send(200, {'row': row})
            if self.path == '/api/vacancies/add':
                return self.send(200, workflow.add_row(workspace, data['values']))
            if self.path in {'/api/vacancies/remove', '/api/vacancies/remove-many'}:
                with self.server.job_lock:
                    if self.server.jobs.get(str(workspace), {}).get('state') == 'running':
                        return self.send(409, {'error': 'Wait for the current search to finish before removing a vacancy.'})
                    result = workflow.remove_rows(workspace, data['selections']) if self.path.endswith('remove-many') else workflow.remove_row(workspace, data['vacancy_id'], data['revision'])
                    return self.send(200, result)
            if self.path == '/api/adopt-applications':
                return self.send(200, workflow.adopt_applications(workspace))
            if self.path == '/api/find':
                count = data['count']
                if type(count) is not int or count < 1:
                    raise ValueError('Enter a positive number of new jobs')
                max_ai_calls = data.get('max_ai_calls', 5)
                if type(max_ai_calls) is not int or max_ai_calls < 0:
                    raise ValueError('Maximum AI calls must be a nonnegative integer')
                search_config.export(workspace)  # Fail synchronously for missing setup.
                connection = ai.status() if max_ai_calls else {'ready': True}
                if not connection['ready']:
                    raise ValueError(connection['message'])
                key = str(workspace)
                with self.server.job_lock:
                    if self.server.jobs.get(key, {}).get('state') == 'running':
                        return self.send(409, {'error': 'A search is already running in this workspace'})
                    job = {'state': 'running', 'message': f'Starting search for {count} new matching jobs…'}
                    self.server.jobs[key] = job
                def run():
                    try:
                        options = {'max_ai_calls': max_ai_calls} if 'max_ai_calls' in data else {}
                        result = workflow.find_jobs(workspace, count, progress=lambda message: job.update(message=message), **options)
                        reason = result.get('coverage', {}).get('stopping_reason')
                        explanation = {'ai_limit': 'AI allowance reached; unresolved listings were left for a later search.', 'discovery_budget': 'Inspection limit reached.',
                                       'source_exhausted': 'No more listings available from the source.',
                                       'source_failure': 'Source access prevented further searching.'}.get(reason, '')
                        usage = result.get('ai_usage', {})
                        tokens = usage.get('reported_tokens')
                        usage_message = ''
                        if usage:
                            usage_message = f" AI calls {usage['ai_calls']}/{usage['max_ai_calls']}; {usage['reused']} reused, {usage['scripted']} scripted, {usage['known_skipped']} tracked skipped."
                            if tokens:
                                counts = ', '.join(f"{tokens[key]} {label}" for key, label in [('input_tokens', 'input'), ('output_tokens', 'output'), ('cached_input_tokens', 'cached input')] if key in tokens)
                                usage_message += f" Reported tokens: {counts} ({usage['calls_with_token_usage']}/{usage['ai_calls']} calls reported)."
                            else:
                                usage_message += ' Token counts were not reported.' if usage['ai_calls'] else ' No AI tokens used.'
                        fx_message = ' ' + workflow.fx_message(result['fx']) if result.get('fx') else ''
                        job.update(state='complete', message=f"Search finished. Added {result['found']} of {result['requested']} new matching jobs. {explanation}{usage_message}{fx_message}".strip(), result=result)
                    except Exception as exc:
                        job.update(state='failed', message=str(exc))
                threading.Thread(target=run, daemon=True).start()
                return self.send(202, job)
            return self.send(404, {'error': 'Not found'})
        except tracking.ConfirmationRequired as exc:
            return self.send(409, {'error': str(exc), 'confirmation_required': True})
        except (ValueError, OSError, KeyError, TypeError) as exc:
            return self.send(400, {'error': str(exc)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', default='', help='Initial workspace; can also be chosen in the UI')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--ai-provider', choices=sorted(ai.PROVIDERS),
                        help='AI CLI for CV interpretation and search (default: JSF_AI_PROVIDER, else the first installed)')
    parser.add_argument('--claude-auth', choices=claude_bridge.AUTH_MODES,
                        help='Claude Code access: subscription (default) or bedrock, using CLAUDE_CODE_USE_BEDROCK and AWS_* variables')
    args = parser.parse_args()
    if args.ai_provider:
        os.environ['JSF_AI_PROVIDER'] = args.ai_provider
    if args.claude_auth:
        os.environ['JSF_CLAUDE_AUTH'] = args.claude_auth
    server = LocalServer(('127.0.0.1', args.port), args.workspace)
    print(f'Job Search Framework: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()

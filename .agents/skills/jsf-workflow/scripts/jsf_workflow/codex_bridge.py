"""Local Codex CLI adapter. Credentials remain in the CLI's own account store."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import signal
import time


def guided_profile(prompt, cancel=None):
    """One bounded interpretation turn; Python owns dialogue state and all writes."""
    connection = status()
    if not connection['ready']:
        raise ValueError(connection['message'])
    question = {'type': 'object', 'additionalProperties': False,
                'required': ['id', 'label', 'help', 'type', 'required', 'options'], 'properties': {
                    'id': {'type': 'string'}, 'label': {'type': 'string'}, 'help': {'type': 'string'},
                    'type': {'type': 'string', 'enum': ['text', 'single', 'multi']},
                    'required': {'type': 'boolean'}, 'options': {'type': 'array', 'items': {'type': 'string'}}}}
    schema = {'type': 'object', 'additionalProperties': False, 'required': ['message', 'questions', 'changes_json'],
              'properties': {'message': {'type': 'string'}, 'questions': {'type': 'array', 'items': question},
                             'changes_json': {'type': 'string'}}}
    with tempfile.TemporaryDirectory(prefix='jsf-guided-') as temp:
        schema_path, output = Path(temp) / 'schema.json', Path(temp) / 'answer.json'
        schema_path.write_text(json.dumps(schema))
        command = ['codex', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
                   '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--cd', temp,
                   '--output-schema', str(schema_path), '--output-last-message', str(output), '-']
        with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, env=environment(), start_new_session=True) as process:
            deadline, first = time.monotonic() + 300, True
            try:
                while True:
                    if cancel is not None and cancel.is_set():
                        raise ValueError('Setup cancelled. Active profile and preferences were not changed.')
                    if time.monotonic() >= deadline:
                        raise ValueError('Codex timed out. Your setup draft is saved; retry when ready.')
                    try:
                        process.communicate(input=prompt if first else None, timeout=.25)
                        break
                    except subprocess.TimeoutExpired:
                        first = False
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.communicate(timeout=3)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.communicate()
                raise
            if process.returncode != 0 or not output.exists():
                raise ValueError('Codex could not complete setup. Check your login, connection and subscription limits, then retry.')
        return json.loads(output.read_text())


def environment():
    env = os.environ.copy()
    # This integration must never silently fall back to API-key billing.
    for key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'):
        env.pop(key, None)
    return env


def status():
    if not shutil.which('codex'):
        return {'ready': False, 'message': 'Install the Codex CLI, then run codex login with ChatGPT.'}
    try:
        run = subprocess.run(['codex', 'login', 'status'], capture_output=True, text=True, env=environment(), timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return {'ready': False, 'message': 'Could not check Codex login. Run codex login in your terminal.'}
    ready = run.returncode == 0 and 'chatgpt' in (run.stdout + run.stderr).lower()
    return {'ready': ready, 'message': 'Connected through your ChatGPT login' if ready else 'Run codex login and choose ChatGPT. API-key logins are not used.'}


def annotation_prompt(criteria, records):
    from .modules import extraction
    contract = Path(__file__).resolve().parents[3] / 'jsf-search/references/annotation-contract.md'
    compact = [{**{key: r.get(key) for key in extraction.RAW_FIELDS}, 'facts': r.get('facts', {})} for r in records]
    return contract.read_text() + '\nINPUT\n' + json.dumps({'criteria': extraction.semantic_criteria(criteria), 'records': compact}, ensure_ascii=False, separators=(',', ':'))


def cache_version():
    """Requested model, installed CLI version and exact extraction prompt contract."""
    contract = Path(__file__).resolve().parents[3] / 'jsf-search/references/annotation-contract.md'
    import hashlib
    try:
        version = subprocess.run(['codex', '--version'], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        version = 'unavailable'
    return 'annotation-v2:' + os.environ.get('JSF_SEARCH_MODEL', 'codex-default') + ':' + version + ':' + hashlib.sha256(contract.read_bytes()).hexdigest()


def token_usage(events):
    totals = {}
    for line in events.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict) or event.get('type') != 'turn.completed' or not isinstance(event.get('usage'), dict):
            continue
        for key, value in event['usage'].items():
            if key.endswith('_tokens') and type(value) is int and value >= 0:
                totals[key] = totals.get(key, 0) + value
    return totals or None


def interpret_batch(criteria, records, expertise=None):
    connection = status()
    if not connection['ready']:
        raise ValueError(connection['message'])
    schema = {'type': 'object', 'additionalProperties': False, 'required': ['annotations'], 'properties': {
        'annotations': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
            'required': ['index', 'facts_json'], 'properties': {'index': {'type': 'integer'}, 'facts_json': {'type': 'string'}}}}}}
    prompt = annotation_prompt(criteria, records)
    with tempfile.TemporaryDirectory(prefix='jsf-codex-') as temp:
        schema_path, output = Path(temp) / 'schema.json', Path(temp) / 'answer.json'
        schema_path.write_text(json.dumps(schema))
        command = ['codex', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
                   '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--cd', temp,
                   '--output-schema', str(schema_path), '--output-last-message', str(output), '-']
        command.append('--json')
        if os.environ.get('JSF_SEARCH_MODEL'):
            command.extend(['--model', os.environ['JSF_SEARCH_MODEL']])
        try:
            run = subprocess.run(command, input=prompt, capture_output=True, text=True, env=environment(), timeout=300)
        except subprocess.TimeoutExpired:
            raise ValueError('Codex timed out. Earlier completed batches remain saved; retry the search.') from None
        if run.returncode != 0 or not output.exists():
            raise ValueError('Codex could not complete this batch. Check codex login, your subscription limits and connection.')
        result = json.loads(output.read_text())
    rows = result.get('annotations', [])
    if len(rows) != len(records) or {r.get('index') for r in rows} != set(range(len(records))):
        raise ValueError('Codex returned incomplete or duplicate annotations')
    facts = [None] * len(records)
    for row in rows:
        if type(row['index']) is not int:
            raise ValueError('Invalid annotation index')
        facts[row['index']] = json.loads(row['facts_json'])
        if not isinstance(facts[row['index']], dict):
            raise ValueError('Codex facts must be objects')
    return {'schema_version': 1, 'facts': facts, 'usage': token_usage(run.stdout), 'prompt_characters': len(prompt)}


def interpret(criteria, records, expertise=None):
    return interpret_batch(criteria, records, expertise)['facts']

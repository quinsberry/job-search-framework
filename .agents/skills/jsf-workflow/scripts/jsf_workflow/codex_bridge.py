"""Local Codex CLI adapter. Credentials remain in the CLI's own account store."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from .bridge_common import ANNOTATION_SCHEMA, GUIDED_SCHEMA, TIMEOUT, annotation_facts, annotation_prompt, run_cancellable
from . import bridge_common


CLI = 'codex'
LABEL = 'Codex'


def command(temp, schema_path, output):
    return ['codex', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
            '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--cd', temp,
            '--output-schema', str(schema_path), '--output-last-message', str(output), '-']


def guided_profile(prompt, cancel=None):
    """One bounded interpretation turn; Python owns dialogue state and all writes."""
    connection = status()
    if not connection['ready']:
        raise ValueError(connection['message'])
    with tempfile.TemporaryDirectory(prefix='jsf-guided-') as temp:
        schema_path, output = Path(temp) / 'schema.json', Path(temp) / 'answer.json'
        schema_path.write_text(json.dumps(GUIDED_SCHEMA))
        returncode, _ = run_cancellable(command(temp, schema_path, output), prompt, environment(), None, cancel, LABEL)
        if returncode != 0 or not output.exists():
            raise ValueError('Codex could not complete setup. Check your login, connection and subscription limits, then retry.')
        return json.loads(output.read_text())


def environment():
    # This integration must never silently fall back to API-key billing.
    return bridge_common.without(('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'))


def status():
    if not shutil.which('codex'):
        return {'ready': False, 'message': 'Install the Codex CLI, then run codex login with ChatGPT.'}
    try:
        run = subprocess.run(['codex', 'login', 'status'], capture_output=True, text=True, env=environment(), timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return {'ready': False, 'message': 'Could not check Codex login. Run codex login in your terminal.'}
    ready = run.returncode == 0 and 'chatgpt' in (run.stdout + run.stderr).lower()
    return {'ready': ready, 'message': 'Connected through your ChatGPT login' if ready else 'Run codex login and choose ChatGPT. API-key logins are not used.'}


def cache_version():
    """Requested model, installed CLI version and exact extraction prompt contract."""
    return ('annotation-v2:' + os.environ.get('JSF_SEARCH_MODEL', 'codex-default') + ':' + bridge_common.cli_version('codex')
            + ':' + bridge_common.contract_digest())


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
    prompt = annotation_prompt(criteria, records)
    with tempfile.TemporaryDirectory(prefix='jsf-codex-') as temp:
        schema_path, output = Path(temp) / 'schema.json', Path(temp) / 'answer.json'
        schema_path.write_text(json.dumps(ANNOTATION_SCHEMA))
        run_command = command(temp, schema_path, output) + ['--json']
        if os.environ.get('JSF_SEARCH_MODEL'):
            run_command.extend(['--model', os.environ['JSF_SEARCH_MODEL']])
        try:
            run = subprocess.run(run_command, input=prompt, capture_output=True, text=True, env=environment(), timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise ValueError('Codex timed out. Earlier completed batches remain saved; retry the search.') from None
        if run.returncode != 0 or not output.exists():
            raise ValueError('Codex could not complete this batch. Check codex login, your subscription limits and connection.')
        result = json.loads(output.read_text())
    return {'schema_version': 1, 'facts': annotation_facts(result, len(records), LABEL), 'usage': token_usage(run.stdout), 'prompt_characters': len(prompt)}


def interpret(criteria, records, expertise=None):
    return interpret_batch(criteria, records, expertise)['facts']

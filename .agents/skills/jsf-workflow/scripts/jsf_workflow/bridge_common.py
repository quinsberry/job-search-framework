"""Provider-neutral pieces of the local AI CLI bridges: prompts, schemas, cancellation and result validation."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time


CONTRACT = Path(__file__).resolve().parents[3] / 'jsf-search/references/annotation-contract.md'
TIMEOUT = 300  # One vacancy annotation batch.
# A guided profile turn returns the complete accumulated profile with quoted evidence; a detailed CV can take
# several minutes on a strong model (about 8 minutes measured for a 29 KB Markdown CV), so it gets more room.
PROFILE_TIMEOUT = 900

_QUESTION = {'type': 'object', 'additionalProperties': False,
             'required': ['id', 'label', 'help', 'type', 'required', 'options'], 'properties': {
                 'id': {'type': 'string'}, 'label': {'type': 'string'}, 'help': {'type': 'string'},
                 'type': {'type': 'string', 'enum': ['text', 'single', 'multi']},
                 'required': {'type': 'boolean'}, 'options': {'type': 'array', 'items': {'type': 'string'}}}}
GUIDED_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['message', 'questions', 'changes_json'],
                 'properties': {'message': {'type': 'string'}, 'questions': {'type': 'array', 'items': _QUESTION},
                                'changes_json': {'type': 'string'}}}
ANNOTATION_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['annotations'], 'properties': {
    'annotations': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
        'required': ['index', 'facts_json'], 'properties': {'index': {'type': 'integer'}, 'facts_json': {'type': 'string'}}}}}}


def annotation_prompt(criteria, records):
    from .modules import extraction
    compact = [{**{key: r.get(key) for key in extraction.RAW_FIELDS}, 'facts': r.get('facts', {})} for r in records]
    return CONTRACT.read_text() + '\nINPUT\n' + json.dumps({'criteria': extraction.semantic_criteria(criteria), 'records': compact}, ensure_ascii=False, separators=(',', ':'))


def contract_digest():
    import hashlib
    return hashlib.sha256(CONTRACT.read_bytes()).hexdigest()


def cli_version(executable):
    try:
        return subprocess.run([executable, '--version'], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return 'unavailable'


def without(keys):
    """The current environment minus provider variables that would silently switch to separately billed access."""
    env = os.environ.copy()
    for key in keys:
        env.pop(key, None)
    return env


def profile_timeout():
    """Seconds allowed for one guided profile turn; JSF_PROFILE_TIMEOUT overrides the default."""
    value = os.environ.get('JSF_PROFILE_TIMEOUT', '').strip()
    if not value:
        return PROFILE_TIMEOUT
    if not value.isdigit() or int(value) < 1:
        raise ValueError('JSF_PROFILE_TIMEOUT must be a positive number of seconds')
    return int(value)


def run_cancellable(command, prompt, env, cwd, cancel, provider):
    """Run one guided profile turn, terminating its process group on cancellation or the deadline. Returns (returncode, stdout)."""
    timeout = profile_timeout()
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, env=env, cwd=cwd, start_new_session=True) as process:
        deadline, first, stdout = time.monotonic() + timeout, True, ''
        try:
            while True:
                if cancel is not None and cancel.is_set():
                    raise ValueError('Setup cancelled. Active profile and preferences were not changed.')
                if time.monotonic() >= deadline:
                    raise ValueError(f'{provider} timed out. Your setup draft is saved; retry when ready.')
                try:
                    stdout, _ = process.communicate(input=prompt if first else None, timeout=.25)
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
        return process.returncode, stdout or ''


def annotation_facts(result, count, provider):
    """Validate indexed annotations: exactly one facts object per input record."""
    rows = result.get('annotations', []) if isinstance(result, dict) else []
    if len(rows) != count or {r.get('index') for r in rows} != set(range(count)):
        raise ValueError(f'{provider} returned incomplete or duplicate annotations')
    facts = [None] * count
    for row in rows:
        if type(row['index']) is not int:
            raise ValueError('Invalid annotation index')
        facts[row['index']] = json.loads(row['facts_json'])
        if not isinstance(facts[row['index']], dict):
            raise ValueError(f'{provider} facts must be objects')
    return facts

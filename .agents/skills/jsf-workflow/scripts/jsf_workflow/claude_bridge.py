"""Local Claude Code CLI adapter. Credentials remain in the CLI's own account store."""
import json
import os
import shutil
import subprocess
import tempfile

from .bridge_common import ANNOTATION_SCHEMA, GUIDED_SCHEMA, TIMEOUT, annotation_facts, annotation_prompt, run_cancellable
from . import bridge_common


CLI = 'claude'
LABEL = 'Claude Code'
# Logins backed by a Claude Pro/Max/Team/Enterprise subscription, as reported by `claude auth status --json`.
SUBSCRIPTION_METHODS = {'claude.ai', 'oauth_token'}
# Any of these makes the CLI bill an API key, gateway or cloud account instead of the subscription.
BILLING_OVERRIDES = ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK',
                     'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_ANTHROPIC_AWS')
# JSF_CLAUDE_AUTH=bedrock is an explicit opt-in to the caller's Amazon Bedrock setup (CLAUDE_CODE_USE_BEDROCK=1 plus
# the usual AWS_PROFILE/AWS_REGION variables), billed to that AWS account. Only the Bedrock switch is kept.
AUTH_MODES = ('subscription', 'bedrock')
SYSTEM_PROMPT = ('You interpret job-search documents for a local Python application. You have no tools. '
                 'Follow the instructions in the user message and answer only with the requested structured output.')


def command(schema, model=None):
    """Print mode without tools, MCP servers, skills, settings files or saved sessions."""
    run = ['claude', '-p', '--output-format', 'json', '--json-schema', json.dumps(schema),
           '--system-prompt', SYSTEM_PROMPT, '--tools', '', '--strict-mcp-config', '--setting-sources', '',
           '--disable-slash-commands', '--no-session-persistence']
    if model:
        run.extend(['--model', model])
    return run


def auth_mode():
    mode = os.environ.get('JSF_CLAUDE_AUTH', '').strip().lower() or 'subscription'
    if mode not in AUTH_MODES:
        raise ValueError('JSF_CLAUDE_AUTH must be one of: ' + ', '.join(AUTH_MODES))
    return mode


def environment():
    # This integration must never silently fall back to API-key or cloud billing; Bedrock only when chosen explicitly.
    kept = ('CLAUDE_CODE_USE_BEDROCK',) if auth_mode() == 'bedrock' else ()
    return bridge_common.without(key for key in BILLING_OVERRIDES if key not in kept)


def status():
    try:
        mode = auth_mode()
    except ValueError as exc:
        return {'ready': False, 'message': str(exc)}
    if not shutil.which('claude'):
        return {'ready': False, 'message': 'Install Claude Code, then run claude auth login with your Claude subscription.'}
    if mode == 'bedrock' and not os.environ.get('CLAUDE_CODE_USE_BEDROCK'):
        return {'ready': False, 'message': 'JSF_CLAUDE_AUTH=bedrock needs CLAUDE_CODE_USE_BEDROCK=1 and your AWS_PROFILE/AWS_REGION in the app environment.'}
    try:
        run = subprocess.run(['claude', 'auth', 'status', '--json'], capture_output=True, text=True, env=environment(), timeout=15)
        state = json.loads(run.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {'ready': False, 'message': 'Could not check Claude Code login. Run claude auth login in your terminal.'}
    logged_in = isinstance(state, dict) and state.get('loggedIn') is True
    if mode == 'bedrock':
        ready = logged_in and state.get('authMethod') == 'third_party' and state.get('apiProvider') == 'bedrock'
        return {'ready': ready, 'message': 'Connected through Amazon Bedrock (billed to your AWS account)' if ready else
                'Claude Code could not use Amazon Bedrock. Check CLAUDE_CODE_USE_BEDROCK, AWS_PROFILE, AWS_REGION and your AWS credentials.'}
    ready = logged_in and state.get('authMethod') in SUBSCRIPTION_METHODS
    return {'ready': ready, 'message': 'Connected through your Claude subscription' if ready else
            'Run claude auth login with your Claude subscription, or set JSF_CLAUDE_AUTH=bedrock to use Amazon Bedrock. API-key logins are not used.'}


def structured(stdout, provider_error):
    """The validated structured output from a print-mode JSON result."""
    try:
        result = json.loads(stdout)
    except ValueError:
        raise ValueError(provider_error) from None
    if not isinstance(result, dict) or result.get('is_error') or not isinstance(result.get('structured_output'), dict):
        raise ValueError(provider_error)
    return result


def token_usage(result):
    usage = result.get('usage') if isinstance(result, dict) else None
    totals = {key: value for key, value in (usage or {}).items() if key.endswith('_tokens') and type(value) is int and value >= 0}
    return totals or None


def guided_profile(prompt, cancel=None):
    """One bounded interpretation turn; Python owns dialogue state and all writes."""
    connection = status()
    if not connection['ready']:
        raise ValueError(connection['message'])
    with tempfile.TemporaryDirectory(prefix='jsf-guided-') as temp:
        returncode, stdout = run_cancellable(command(GUIDED_SCHEMA), prompt, environment(), temp, cancel, LABEL)
    error = 'Claude Code could not complete setup. Check your login, connection and subscription limits, then retry.'
    if returncode != 0:
        raise ValueError(error)
    return structured(stdout, error)['structured_output']


def cache_version():
    """Provider, access mode, requested model, installed CLI version and exact extraction prompt contract."""
    return ('annotation-v2:claude:' + ('bedrock:' if auth_mode() == 'bedrock' else '') + os.environ.get('JSF_SEARCH_MODEL', 'claude-default') + ':' + bridge_common.cli_version('claude')
            + ':' + bridge_common.contract_digest())


def interpret_batch(criteria, records, expertise=None):
    connection = status()
    if not connection['ready']:
        raise ValueError(connection['message'])
    prompt = annotation_prompt(criteria, records)
    error = 'Claude Code could not complete this batch. Check claude auth login, your subscription limits and connection.'
    with tempfile.TemporaryDirectory(prefix='jsf-claude-') as temp:
        try:
            run = subprocess.run(command(ANNOTATION_SCHEMA, os.environ.get('JSF_SEARCH_MODEL')), input=prompt, capture_output=True, text=True,
                                 env=environment(), cwd=temp, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise ValueError('Claude Code timed out. Earlier completed batches remain saved; retry the search.') from None
    if run.returncode != 0:
        raise ValueError(error)
    result = structured(run.stdout, error)
    return {'schema_version': 1, 'facts': annotation_facts(result['structured_output'], len(records), LABEL),
            'usage': token_usage(result), 'prompt_characters': len(prompt)}


def interpret(criteria, records, expertise=None):
    return interpret_batch(criteria, records, expertise)['facts']

"""Selects the local AI CLI used for interpretation. Every provider bridge exposes the same operations."""
import os
import shutil

from . import claude_bridge, codex_bridge


PROVIDERS = {'codex': codex_bridge, 'claude': claude_bridge}


def bridge():
    """JSF_AI_PROVIDER chooses explicitly; otherwise the first installed CLI, Codex first for existing setups."""
    name = os.environ.get('JSF_AI_PROVIDER', '').strip().lower()
    if name:
        if name not in PROVIDERS:
            raise ValueError('JSF_AI_PROVIDER must be one of: ' + ', '.join(PROVIDERS))
        return PROVIDERS[name]
    return next((provider for provider in PROVIDERS.values() if shutil.which(provider.CLI)), codex_bridge)


def status():
    try:
        provider = bridge()
    except ValueError as exc:
        return {'ready': False, 'message': str(exc), 'provider': None, 'label': 'AI'}
    return {**provider.status(), 'provider': provider.CLI, 'label': provider.LABEL}


def label():
    try:
        return bridge().LABEL
    except ValueError:
        return 'AI'


def guided_profile(prompt, cancel=None):
    return bridge().guided_profile(prompt, cancel)


def interpret_batch(criteria, records, expertise=None):
    return bridge().interpret_batch(criteria, records, expertise)


def cache_version():
    return bridge().cache_version()

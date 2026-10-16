"""Resolve the coordinator's explicitly declared specialist dependencies."""
from pathlib import Path
import sys

SKILLS = Path(__file__).resolve().parents[3]
for name in ('search', 'profile', 'vacancies', 'application'):
    scripts = SKILLS / ('jsf-' + name) / 'scripts'
    if not (scripts / ('jsf_' + name)).is_dir():
        raise ImportError('jsf-workflow requires sibling jsf-' + name + '; install it alongside this skill')
    if str(scripts) not in sys.path:
        sys.path.append(str(scripts))

from jsf_search import evaluate, search
from jsf_profile import profile as candidate, search_config
from jsf_vacancies import vacancies
from jsf_application import applications, tracking

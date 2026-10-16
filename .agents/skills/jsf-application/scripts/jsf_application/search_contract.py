"""Declared dependency on jsf-search's public validation/identity interface."""
from pathlib import Path
import sys

scripts = Path(__file__).resolve().parents[3] / 'jsf-search' / 'scripts'
if not (scripts / 'jsf_search').is_dir():
    raise ImportError('jsf-application requires sibling jsf-search; install it alongside this skill')
if str(scripts) not in sys.path:
    sys.path.append(str(scripts))
from jsf_search import canonical_url

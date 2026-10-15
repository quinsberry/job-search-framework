"""Load the existing specialists without copying their domain rules."""
from pathlib import Path
import sys

SKILLS = Path(__file__).resolve().parents[2]
for name in ('jsf-search', 'jsf-profile', 'jsf-vacancies', 'jsf-application'):
    sys.path.insert(0, str(SKILLS / name / 'scripts'))

import evaluate
import search
import vacancies
import profile as candidate
import search_config
import applications
import tracking

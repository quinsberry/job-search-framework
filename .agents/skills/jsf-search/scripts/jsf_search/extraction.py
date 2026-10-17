"""Conservative, quote-backed Python extraction before semantic interpretation."""
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
import re

from .evaluate import assess, criteria, text, timestamp

VERSION = 'explicit-fields-v2'
RAW_FIELDS = ('title', 'company', 'location', 'description', 'seniority_label', 'employment_type', 'posted_at', 'fetch_status', 'active')


def semantic_criteria(data):
    c = deepcopy(criteria(data))
    for key in ('target_count', 'discovery_budget', 'conversions', 'posting_age_days', 'company_exclusions'):
        c.pop(key, None)
    if c['compensation'] is not None:
        c['compensation'] = sorted({r['contract'] for r in c['compensation']})
    return c


def cache_key(data, record, interpreter_version):
    payload = [VERSION, interpreter_version, semantic_criteria(data), {k: record.get(k) for k in RAW_FIELDS}]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def explicit_facts(record):
    facts = {}
    description = record.get('description') or ''
    def obs(value, quote):
        return {'value': value, 'evidence': [{'field': 'description', 'quote': quote}]}
    fields = {'role': ('role_titles', True), 'seniority': ('seniority', False),
              'work arrangement': ('work_arrangements', True), 'eligible countries': ('eligible_countries', True),
              'office locations': ('office_locations', True)}
    for label, (field, multiple) in fields.items():
        matches = list(re.finditer(r'^' + label + r': ([^\n]+)$', description, re.I | re.M))
        if len(matches) != 1:
            continue
        match = matches[0]
        value = match[1].strip().rstrip('.')
        if field == 'seniority' and text(value) not in {'junior', 'middle', 'senior', 'staff', 'lead', 'principal'}:
            continue
        if field == 'work_arrangements' and text(value) not in {'remote', 'hybrid', 'onsite'}:
            continue
        # Lists use semicolons so a city,country pair remains one value.
        values = [text(v) for v in value.split(';') if v.strip()]
        if values:
            facts[field] = obs(values if multiple else values[0], match[0])
    skills = list(re.finditer(r'^Required skills: ([^\n]+)$', description, re.I | re.M))
    if len(skills) == 1:
        match = skills[0]
        # Only exact skill names in an explicit comma-separated required list.
        names = [text(v).rstrip('.') for v in match[1].split(',')]
        if all(re.fullmatch(r'[\w.+#-]+', name) for name in names):
            facts['technical'] = {name: obs(True, match[0]) for name in names}
    bands = []
    pattern = r'^(B2B|UoP):? (\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?) (PLN|EUR|USD)/(month|year|hour) (before VAT|gross)\.?$'
    for match in re.finditer(pattern, description, re.I | re.M):
        contract, low, high, currency, period, basis = match.groups()
        basis = 'before_vat' if text(basis) == 'before vat' else 'gross'
        if Decimal(low) > Decimal(high) or Decimal(low) < 0 or (text(contract), basis) not in {('b2b', 'before_vat'), ('uop', 'gross')}:
            continue
        bands.append({'contract': text(contract), 'low': low, 'high': high, 'currency': text(currency),
                      'period': text(period), 'basis': basis, 'evidence': obs(None, match[0])['evidence']})
    if bands:
        facts['compensation'] = bands
    return facts


def prepare(data, record, observed_at):
    """Never reject from a keyword, missing salary or a title/location label alone."""
    c = criteria(data)
    facts = explicit_facts(record)
    row = assess({**record, 'facts': facts}, c, timestamp(observed_at, 'observed_at'))
    usable = record.get('fetch_status', 'ok') == 'ok' and bool((record.get('description') or '').strip())
    conclusive_raw_failure = any(check['status'] == 'fail' and check['criterion'] in {'activity', 'posting_age', 'company_exclusions'} for check in row['checks'])
    quotes = set()
    def collect(value):
        if isinstance(value, dict):
            for entry in value.get('evidence', []):
                quotes.add(entry['quote'].strip())
            for key, child in value.items():
                if key != 'evidence': collect(child)
        elif isinstance(value, list):
            for child in value: collect(child)
    collect(facts)
    unparsed_prose = any(line.strip() and line.strip() not in quotes for line in (record.get('description') or '').splitlines())
    needs_ai = usable and not conclusive_raw_failure and (row['status'] == 'needs_clarification' or unparsed_prose)
    return {'schema_version': 1, 'facts': facts, 'needs_ai': bool(needs_ai), 'cacheable': bool(usable and not unparsed_prose and all(check['status'] != 'unknown' for check in row['checks']))}

"""Readable profile facts, with immutable supporting evidence and atomic publication."""
from copy import deepcopy
import hashlib
import html
from pathlib import Path
import re

from . import profile as p


MARKER = re.compile(r'<!-- jsf-profile:1 evidence:([a-f0-9]{64}) -->')


def escape(value):
    text = html.escape(value, quote=False).replace('\\', '&#92;').replace('*', '&#42;').replace('_', '&#95;')
    text = text.replace('\r', '&#13;').replace('\n', '<br>')
    return '&#85;nknown' if text == 'Unknown' else text


def support(profile):
    return dict(schema_version=1, sources=deepcopy(profile['sources']), issues=list(profile['issues']),
                conflicts=deepcopy(profile['conflicts']), records={r['id']: {
                    'section': r['section'], 'facts': {k: {**{key: deepcopy(value) for key, value in f.items() if key != 'value'},
                                                         'fingerprint': p.digest(f['value'])} for k, f in r['facts'].items()}}
                    for r in profile['records']})


def field_lines(label, value):
    if isinstance(value, list):
        return [f'- **{label}:**'] + ['  - ' + escape(item) for item in value]
    return [f'- **{label}:** ' + ('Unknown' if value is None else escape(value))]


def render(profile):
    from .profile_template import definition
    p.validate_profile(profile)
    template = definition()
    replacements = {'{{evidence_marker}}': f'<!-- jsf-profile:1 evidence:{p.digest(support(profile))} -->',
                    '{{instructions}}': '<!-- Keep section names, record IDs and field labels. Use Unknown to clear a fact. -->'}
    lines = []
    for line in template['header']:
        lines += [replacements.get(line, line), '']
    for group in template['sections']:
        section = group['id']
        records = [r for r in profile['records'] if r['section'] == section]
        lines += [group['heading'], '']
        if section in {'experience', 'education'}:
            records.sort(key=p.chronology)
        for record in records:
            title = escape(p.heading(record))
            lines += [group['record_heading'].replace('{{title}}', title).replace('{{id}}', record['id']), '']
            for field in group['fields']:
                value = record['facts'].get(field['id'], {}).get('value')
                lines += field_lines(field['label'], value)
            lines.append('')
    return '\n'.join(lines)


def parse(text):
    p.string(text, 'Profile Markdown')
    p.require(len(text) <= 200000, 'Profile Markdown must be under 200,000 characters')
    records, section, record, field = [], None, None, None
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line == '# Candidate profile' or MARKER.fullmatch(line) or line == '<!-- Keep section names, record IDs and field labels. Use Unknown to clear a fact. -->':
            continue
        error = f'Profile line {number}: '
        if line.startswith('## '):
            section = line[3:].lower()
            p.require(section in p.FIELDS, error + 'unknown section; use Identity, Experience, Skills, Projects, Education, Languages or Certifications')
            record, field = None, None
        elif line.startswith('### '):
            p.require(section is not None, error + 'put a section heading before a record')
            match = re.fullmatch(r'### .* <!-- id: ([a-z0-9][a-z0-9-]*) -->', line)
            record = dict(id=match[1] if match else line[4:], section=section, facts={})
            records.append(record)
            field = None
        elif line.startswith('  - '):
            p.require(record is not None and field is not None and isinstance(record['facts'][field], list), error + 'list item needs a field label with no value')
            record['facts'][field].append(html.unescape(line[4:].replace('<br>', '\n')))
        else:
            match = re.fullmatch(r'- \*\*([A-Za-z ]+):\*\*(?: (.*))?', line)
            p.require(match is not None and record is not None, error + 'expected ### record-id or - **Field:** value')
            field = match[1].lower().replace(' ', '_')
            p.require(field in p.FIELDS[section] and field not in record['facts'], error + 'unknown or duplicate field')
            raw = match[2]
            record['facts'][field] = [] if not raw else None if raw == 'Unknown' else html.unescape(raw.replace('<br>', '\n'))
    p.require(bool(records), 'Profile needs at least one record, for example ## Identity / ### identity / - **Full Name:** Your name')
    return records


def interpret(text, metadata):
    """Manual differences are explicit user corrections; unchanged evidence is retained."""
    records = parse(text)
    profile = dict(schema_version=1, sources=deepcopy(metadata['sources']), records=[],
                   issues=list(metadata['issues']), conflicts=deepcopy(metadata['conflicts']))
    old = metadata['records']
    present = {r['id']: r for r in records}
    # Removing an accepted field/record clears its claims without deleting history.
    for identifier, prior in old.items():
        if identifier not in present:
            item = dict(id=identifier, section=prior['section'], facts={})
            records.append(item)
            present[identifier] = item
        p.require(present[identifier]['section'] == prior['section'], 'An existing record section cannot change')
        for field in prior['facts']:
            present[identifier]['facts'].setdefault(field, None)
    corrections, statements = [], []
    for record in records:
        facts = {}
        for field, value in record['facts'].items():
            prior = old.get(record['id'], {}).get('facts', {}).get(field)
            if prior is None and value is None:
                continue
            if prior and prior['fingerprint'] == p.digest(value):
                facts[field] = {**{key: deepcopy(v) for key, v in prior.items() if key != 'fingerprint'}, 'value': value}
            else:
                p.validate_value_shape(field, value)
                quote = f"Clear {record['id']}/{field}." if value is None else '\n'.join(value) if isinstance(value, list) else value
                statements.append(f"{record['id']}/{field}: {quote}")
                facts[field] = dict(value=value, evidence=[], user_corrected=True)
                corrections.append((record['id'], field, facts[field], quote))
        profile['records'].append({**record, 'facts': facts})
    if corrections:
        raw = '\n\n'.join(statements)
        identifier = hashlib.sha256(b'user\0' + raw.encode()).hexdigest()
        profile['sources'][identifier] = dict(id=identifier, name='Profile edits.md', kind='user', format='md',
                                             pages=[dict(page=1, text=raw)], issues=[])
        for record_id, field, fact, quote in corrections:
            fact['evidence'] = [dict(source_id=identifier, page=1, quote=quote)]
            profile['conflicts'] = [c for c in profile['conflicts'] if (c['record_id'], c['field']) != (record_id, field)]
    profile['records'].sort(key=lambda r: (list(p.FIELDS).index(r['section']), r['id']))
    return p.validate_profile(profile)


def load(workspace):
    directory = Path(workspace) / 'candidate'
    text = (directory / 'profile.md').read_text(encoding='utf-8')
    marker = MARKER.findall(text)
    p.require(len(marker) == 1, 'Profile needs its single jsf-profile evidence marker; restore it before editing')
    metadata = p.read_json(directory / 'evidence' / (marker[0] + '.json'))
    p.require(p.digest(metadata) == marker[0] and metadata.get('schema_version') == 1, 'Profile evidence is invalid or changed')
    return interpret(text, metadata)


def persist(workspace, profile):
    directory = Path(workspace) / 'candidate'
    metadata = support(profile)
    text = render(profile)
    # Immutable evidence is written first; one atomic Markdown replacement publishes it.
    p.atomic_write(directory / 'evidence' / (p.digest(metadata) + '.json'), p.encoded(metadata))
    legacy = [directory / name for name in ('profile.yaml', 'README.md', 'profile.json') if (directory / name).exists()]
    if legacy:
        backup = directory / 'backups' / p.digest({file.name: file.read_text(encoding='utf-8') for file in legacy})
        for file in legacy:
            p.atomic_write(backup / file.name, file.read_text(encoding='utf-8'))
    p.atomic_write(directory / 'profile.md', text)
    for file in legacy:
        file.unlink()


def edit_plan(existing, text, base_revision):
    profile = interpret(text, support(existing or p.empty_profile()))
    result = p.summary(profile)
    result['base_revision'] = base_revision
    return result

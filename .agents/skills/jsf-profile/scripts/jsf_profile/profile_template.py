"""Read the profile owner's layout and field examples, without candidate data."""
import json
from pathlib import Path
import re

from . import profile as p


PATH = Path(__file__).resolve().parents[2] / 'references' / 'profile-template.md'


def definition():
    blocks = re.findall(r'^```markdown\n(.*?)^```\s*$', PATH.read_text(encoding='utf-8'), re.M | re.S)
    p.require(len(blocks) == 1, 'Profile template must contain one Markdown layout block')
    header, sections, section, example = [], [], None, None
    for line in blocks[0].splitlines():
        if not line:
            continue
        if line.startswith('## '):
            section = dict(id=line[3:].lower(), label=line[3:], heading=line, fields=[])
            p.require(section['id'] in p.FIELDS and not any(s['id'] == section['id'] for s in sections), 'Invalid or duplicate template section')
            sections.append(section)
        elif section is None:
            header.append(line)
        elif line.startswith('### '):
            p.require(line == '### {{title}} <!-- id: {{id}} -->' and 'record_heading' not in section, 'Invalid template record pattern')
            section['record_heading'] = line
        elif line.startswith('<!-- Layout: '):
            layout = line[len('<!-- Layout: '):-len(' -->')]
            p.require(line.endswith(' -->') and layout == section['id'] and layout in {'identity', 'skills', 'languages'}, 'Invalid compact template layout')
            section['layout'] = layout
        elif line.startswith('<!-- Example: '):
            p.require(example is None and line.endswith(' -->'), 'Invalid template example')
            example = json.loads(line[len('<!-- Example: '):-len(' -->')])
        else:
            match = re.fullmatch(r'- \*\*([A-Za-z ]+):\*\* Unknown', line)
            p.require(match is not None and example is not None, 'Template fields need labels and examples')
            field = match[1].lower().replace(' ', '_')
            p.require(field in p.FIELDS[section['id']] and not any(f['id'] == field for f in section['fields']), 'Invalid or duplicate template field')
            p.validate_value_shape(field, example)
            section['fields'].append(dict(id=field, label=match[1], type='list' if field in p.LIST_FIELDS else 'text', example=example))
            example = None
    p.require(header == ['# Candidate profile', '{{evidence_marker}}', '{{instructions}}'], 'Invalid template header')
    p.require([s['id'] for s in sections] == list(p.FIELDS), 'Template must contain all profile sections in the agreed order')
    for section in sections:
        p.require(('layout' in section) != ('record_heading' in section) and {f['id'] for f in section['fields']} == set(p.FIELDS[section['id']]), 'Template fields differ from the profile contract')
    p.require(example is None, 'Template has an unused example')
    return dict(header=header, sections=sections)


def help_document():
    from .markdown_profile import field_lines
    sections = [{key: section[key] for key in ('id', 'label', 'fields')} for section in definition()['sections']]
    for section in sections:
        for field in section['fields']:
            if section['id'] == 'skills':
                field['markdown_example'] = '- ' + field['example']
            elif section['id'] == 'languages':
                name = next(f['example'] for f in section['fields'] if f['id'] == 'name')
                field['markdown_example'] = '- ' + name + (' — ' + field['example'] if field['id'] == 'level' else '')
            else:
                field['markdown_example'] = '\n'.join(field_lines(field['label'], field['example']))
    return dict(schema_version=1, sections=sections)

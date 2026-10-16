"""Search configuration owned by jsf-profile; current YAML is always authoritative."""

from copy import deepcopy
import json
from pathlib import Path

from .profile import ValidationError, atomic_write, encoded, load, read_yaml, require, string, summary


FILL = "__FILL_ME__"
REQUIRED = ('titles', 'target_count', 'candidate.country', 'seniorities',
            'compensation', 'work_arrangements', 'technical.required')
DEFAULTS = {
    'sources': ['linkedin'], 'candidate.city': None, 'candidate.work_authorization': None,
    'office_locations': None, 'technical.preferred': [], 'technical.excluded': [],
    'vacancy_types.required': None, 'vacancy_types.preferred': [], 'vacancy_types.excluded': [],
    'company_exclusions': [], 'posting_age_days': None,
}
OMIT = {'preferences', 'discovery_budget', 'conversions.hours_per_month', 'conversions.fx'}


def unfilled(value, path=''):
    if isinstance(value, str) and value == FILL:
        return [path]
    if isinstance(value, dict):
        return [p for key, item in value.items() for p in unfilled(item, f'{path}.{key}' if path else key)]
    if isinstance(value, list):
        return [p for index, item in enumerate(value) for p in unfilled(item, f'{path}[{index}]')]
    return []


def all_unfilled(value):
    return value == FILL if isinstance(value, str) else isinstance(value, dict) and bool(value) and all(all_unfilled(x) for x in value.values())


def lookup(data, path):
    value = data
    for part in path.split('.'):
        if not isinstance(value, dict) or part not in value:
            return FILL
        value = value[part]
    return value


def resolve(data):
    c = deepcopy(data)
    applied = {}
    for path in list(DEFAULTS) + sorted(OMIT):
        parent = c
        parts = path.split('.')
        for part in parts[:-1]:
            if part not in parent:
                parent[part] = {}
            if not isinstance(parent[part], dict):
                break  # Leave a malformed container for the existing criteria validator.
            parent = parent[part]
        else:
            key = parts[-1]
            if all_unfilled(parent.get(key, FILL)):
                if path in DEFAULTS:
                    parent[key] = deepcopy(DEFAULTS[path])
                    applied[path] = deepcopy(DEFAULTS[path])
                else:
                    parent.pop(key, None)
                    applied[path] = 'automatic' if path in {'preferences', 'discovery_budget'} else 'unknown'
    return c, applied


def validate_document(data):
    require(isinstance(data, dict) and set(data) == {'schema_version', 'profile_ref', 'criteria'}, 'invalid search config fields')
    require(type(data['schema_version']) is int and data['schema_version'] == 1, 'search config schema_version must be 1')
    require(data['profile_ref'] == 'candidate/profile.yaml', 'profile_ref must be candidate/profile.yaml')
    require(isinstance(data['criteria'], dict), 'config criteria must be an object')
    # Reject non-JSON/cyclic YAML before recursively inspecting placeholders.
    try:
        encoded(data)
    except (ValueError, TypeError) as exc:
        raise ValidationError(f'config must contain finite JSON-compatible YAML: {exc}') from None
    c, defaults = resolve(data['criteria'])
    missing = sorted(set(unfilled(c) + [p for p in REQUIRED if lookup(c, p) == FILL]))
    errors = []
    normalized = None
    if not missing:
        from .search_contract import criteria, ValidationError as SearchError
        try:
            normalized = criteria(c)
        except SearchError as exc:
            errors.append(str(exc))
    return {'schema_version': 1, 'outcome': 'ready' if not missing and not errors else 'partial',
            'missing_fields': missing, 'defaults': defaults, 'errors': errors, 'criteria': normalized}


def inspect_config(workspace):
    path = Path(workspace) / 'search-config.yml'
    result = validate_document(read_yaml(path))
    profile = load(workspace)
    profile_status = summary(profile)['outcome'] if profile is not None else 'missing'
    if profile_status in {'missing', 'needs_clarification'}:
        result['errors'].append('candidate/profile.yaml needs supported CV facts; use jsf-profile intake')
        result['outcome'] = 'partial'
    return {**result, 'path': str(path.resolve()), 'profile_status': profile_status}


def initialize(workspace, country=None, city=None):
    path = Path(workspace) / 'search-config.yml'
    if path.exists():
        return {**inspect_config(workspace), 'created': False}
    profile = load(workspace)  # Invalid existing YAML must not be bypassed.
    if profile is not None:
        from .profile import protect_sources
        protect_sources(workspace, profile['sources'].values())
    content = (Path(__file__).resolve().parents[2] / 'references' / 'search-template.yml').read_text(encoding='utf-8')
    for field, value in (('country', country), ('city', city)):
        if value is not None:
            string(value, field)
            require(value != FILL, f'{field} must be a value, not a placeholder')
            content = content.replace(f'    {field}: {FILL}', f'    {field}: {json.dumps(value, ensure_ascii=False)}')
    if profile is not None:
        disputed = {(x['record_id'], x['field']) for x in profile['conflicts']}
        roles, technologies = set(), set()
        for record in profile['records']:
            for field, fact in record['facts'].items():
                if (record['id'], field) in disputed or fact['value'] is None:
                    continue
                if field == 'role' and record['section'] in {'experience', 'projects'}:
                    roles.update(fact['value'] if isinstance(fact['value'], list) else [fact['value']])
                if field == 'technologies' or (field == 'name' and record['section'] == 'skills'):
                    technologies.update(fact['value'] if isinstance(fact['value'], list) else [fact['value']])
        # Quoted JSON keeps arbitrary CV text inside one comment, never active YAML.
        content = '# CV role examples (not chosen targets): ' + json.dumps(sorted(roles)) + '\n' + '# CV technology examples (not mandatory filters): ' + json.dumps(sorted(technologies)) + '\n' + content
    atomic_write(path, content)
    return {**inspect_config(workspace), 'created': True}


def export(workspace):
    result = inspect_config(workspace)
    require(result['outcome'] == 'ready', 'search config is incomplete or invalid: ' + '; '.join(result['missing_fields'] + result['errors']))
    return result['criteria']

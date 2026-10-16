"""Read-only setup checks composed from the owning skills' validators."""
from jsf_workflow import codex_bridge, workflow
from jsf_workflow.modules import candidate, search_config


def missing_choices(fields):
    names = {'titles': 'preferred roles', 'target_count': 'number of jobs to find',
             'candidate.country': 'country of residence', 'seniorities': 'seniority levels',
             'compensation': 'minimum pay', 'work_arrangements': 'remote, hybrid or onsite work',
             'technical.required': 'must-have skills'}
    fields = sorted(fields, key=lambda field: list(names).index(field) if field in names else len(names))
    choices = list(dict.fromkeys(names.get(field, 'other search choices') for field in fields))
    if len(choices) > 3:
        return 'Finish choosing your preferred roles, pay and working arrangements.'
    description = choices[0] if len(choices) == 1 else ', '.join(choices[:-1]) + ' and ' + choices[-1]
    return 'Finish choosing your ' + description + '.'


def inspect(value):
    checks = []
    def add(key, label, state, message, request='', details=None):
        checks.append(dict(key=key, label=label, state=state, message=message, request=request))
        if details:
            checks[-1]['details'] = details

    try:
        workspace = workflow.workspace_path(value)
    except (ValueError, OSError) as exc:
        add('workspace', 'Workspace opened', 'blocked' if value else 'pending', str(exc))
        for key, label in [('profile', 'Candidate profile usable'), ('config', 'Search preferences configured')]:
            add(key, label, 'pending', 'Open a workspace to check this step.')
    else:
        add('workspace', 'Workspace opened', 'ready', str(workspace))
        profile_request = f'Use jsf-profile to set up or repair my candidate profile in workspace {str(workspace)!r}. Ask me for my PDF or Markdown CV if needed. Preserve supported facts and ask about missing information.'
        try:
            profile = candidate.load(workspace)
            summary = candidate.summary(profile) if profile is not None else None
            outcome = summary['outcome'] if summary else 'missing'
            state = {'ready': 'ready', 'partial': 'warning'}.get(outcome, 'blocked')
            message = {'ready': 'Your saved profile is ready to use.', 'partial': 'Usable for search. Some facts are unknown or disputed.',
                       'missing': 'Add your CV to create a profile.', 'needs_clarification': 'Add a readable CV or tell us about your experience.'}[outcome]
            details = []
            if outcome == 'partial':
                records = {r['id']: r for r in profile['records']}
                counts = []
                for key, singular, plural in [('unknowns', 'missing detail', 'missing details'), ('conflicts', 'conflicting fact', 'conflicting facts'), ('issues', 'source issue', 'source issues')]:
                    count = len(summary[key])
                    if count:
                        counts.append(f'{count} {singular if count == 1 else plural}')
                message = 'Usable for search. ' + ', '.join(counts) + '. These do not block searching.'
                for missing in summary['unknowns']:
                    record = records.get(missing['record_id'])
                    label = candidate.heading(record) if record else 'Identity'
                    field = 'proficiency level' if record and record['section'] in {'skills', 'languages'} and missing['field'] == 'level' else missing['field'].replace('_', ' ')
                    details.append(f'{label}: {field} not specified')
                for conflict in summary['conflicts']:
                    details.append(f"{candidate.heading(records[conflict['record_id']])}: conflicting {conflict['field'].replace('_', ' ')}")
                details.extend(summary['issues'])
            add('profile', 'Candidate profile usable', state, message, profile_request if state != 'ready' else '', details)
        except (ValueError, OSError) as exc:
            add('profile', 'Candidate profile usable', 'blocked', str(exc), profile_request)
        config_request = f'Use jsf-profile to complete or repair search-config.yml in workspace {str(workspace)!r}. Ask me for unresolved search choices; do not invent preferences.'
        try:
            config = search_config.inspect_config(workspace)
            problems = config['missing_fields'] + config['errors']
            message = ('Your search preferences are saved.' if not problems else
                       missing_choices(config['missing_fields']) if config['missing_fields'] else
                       'Your preferences are saved. Add a candidate profile before searching.' if config['profile_status'] in {'missing', 'needs_clarification'} else
                       'Some choices need attention. Open your preferences to review them.')
            add('config', 'Search preferences configured', 'ready' if config['outcome'] == 'ready' else 'blocked',
                message,
                config_request + ' Reported problems: ' + '; '.join(problems) if problems else '')
            if problems:
                checks[-1]['diagnostics'] = problems
        except (ValueError, OSError) as exc:
            missing = not (workspace / 'search-config.yml').exists()
            add('config', 'Search preferences configured', 'blocked',
                'Your search preferences aren’t set yet.' if missing else
                'We couldn’t read your saved preferences. Open them to check what needs fixing.', config_request)
            if not missing:
                checks[-1]['diagnostics'] = [str(exc)]
    connection = codex_bridge.status()
    add('codex', 'Codex connected', 'ready' if connection['ready'] else 'blocked', connection['message'],
        '' if connection['ready'] else 'Help me connect the local job-search app to the Codex CLI using my ChatGPT subscription. Check CLI installation and login; keep credentials in the CLI account store.')
    order = ['workspace', 'codex', 'profile', 'config']
    checks.sort(key=lambda check: order.index(check['key']))
    for check in checks:
        check['label'] = {'workspace': 'Workspace opened', 'codex': 'Codex connected',
                          'profile': 'Candidate profile', 'config': 'Search preferences'}[check['key']]
    return {'checks': checks, 'ready': all(c['state'] in {'ready', 'warning'} for c in checks)}

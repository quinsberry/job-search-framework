"""Read-only setup checks composed from the owning skills' validators."""
import codex_bridge
import workflow
from modules import candidate, search_config


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
            message = {'ready': 'Profile validated.', 'partial': 'Usable for search. Some facts are unknown or disputed.',
                       'missing': 'candidate/profile.yaml is missing.', 'needs_clarification': 'Profile needs supported CV facts.'}[outcome]
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
            add('config', 'Search preferences configured', 'ready' if config['outcome'] == 'ready' else 'blocked',
                'Search preferences validated. Live source access is checked during search.' if not problems else '; '.join(problems),
                config_request + ' Reported problems: ' + '; '.join(problems) if problems else '')
        except (ValueError, OSError) as exc:
            add('config', 'Search preferences configured', 'blocked', str(exc), config_request)
    connection = codex_bridge.status()
    add('codex', 'Codex connected', 'ready' if connection['ready'] else 'blocked', connection['message'],
        '' if connection['ready'] else 'Help me connect the local job-search app to the Codex CLI using my ChatGPT subscription. Check CLI installation and login; keep credentials in the CLI account store.')
    return {'checks': checks, 'ready': all(c['state'] in {'ready', 'warning'} for c in checks)}

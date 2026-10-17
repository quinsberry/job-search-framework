"""Compose profile, search, history and application contracts for the local UI."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading

from .modules import evaluate, search, vacancies, candidate, search_config, tracking, extraction
from . import codex_bridge


LOCK = threading.RLock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def revision(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def workspace_path(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Choose a workspace directory')
    path = Path(value).expanduser().resolve()
    if not path.is_dir():
        raise ValueError('Workspace directory does not exist')
    return path


def table(workspace):
    workspace = workspace_path(str(workspace))
    with LOCK:
        records = tracking.records(workspace)
        rows, linked = [], set()
        for vacancy in vacancies.query(workspace)['vacancies']:
            applications_for_vacancy = tracking.matches(records, vacancy['vacancy_id'], vacancy['aliases'], vacancy['previous_ids'])
            linked.update(id(record) for record in applications_for_vacancy)
            row = {key: value for key, value in vacancy.items() if key not in {'aliases', 'previous_ids', 'revision'}}
            row.update(applied=any(tracking.submitted(record) for record in applications_for_vacancy),
                       applied_by_application={record.get('application_id'): tracking.submitted(record) for record in applications_for_vacancy},
                       applications=applications_for_vacancy, revision=revision([vacancy['revision'], applications_for_vacancy]))
            rows.append(row)
        return {'schema_version': 1, 'workspace': str(workspace), 'rows': rows,
                'unlinked_applications': [record for record in records if id(record) not in linked]}


def adopt_applications(workspace):
    workspace = workspace_path(str(workspace))
    with LOCK:
        vacancies.adopt(workspace, table(workspace)['unlinked_applications'], now())
        return table(workspace)


def add_row(workspace, values):
    workspace = workspace_path(str(workspace))
    with LOCK:
        result = vacancies.create(workspace, values, now())
        row = next(r for r in table(workspace)['rows'] if r['vacancy_id'] == result['vacancy_id'])
        return {'schema_version': 1, 'created': result['created'], 'row': row}


def remove_rows(workspace, selections):
    workspace = workspace_path(str(workspace))
    if not isinstance(selections, list) or not selections:
        raise ValueError('Select at least one vacancy to remove.')
    with LOCK:
        rows = {r['vacancy_id']: r for r in table(workspace)['rows']}
        selected_ids, changed = set(), []
        for selection in selections:
            if not isinstance(selection, dict) or set(selection) != {'vacancy_id', 'revision'} or any(not isinstance(v, str) or not v for v in selection.values()):
                raise ValueError('Invalid removal selection.')
            identifier = selection['vacancy_id']
            if identifier in selected_ids:
                raise ValueError('Duplicate removal selection.')
            selected_ids.add(identifier)
            row = rows.get(identifier)
            if row is None or row['revision'] != selection['revision']:
                changed.append(f"{row['values'].get('company', '')} — {row['values'].get('title', identifier)}" if row else identifier)
        if changed:
            raise ValueError('Nothing removed. These vacancies changed or are no longer available: ' + '; '.join(changed) + '. Refresh the table and review the selection before retrying.')
        owner_rows = {r['vacancy_id']: r for r in vacancies.query(workspace)['vacancies']}
        vacancies.delete_many(workspace, [{'vacancy_id': s['vacancy_id'], 'revision': owner_rows[s['vacancy_id']]['revision']} for s in selections])
        return {'schema_version': 1, 'removed': [s['vacancy_id'] for s in selections]}


def remove_row(workspace, identifier, expected_revision):
    remove_rows(workspace, [{'vacancy_id': identifier, 'revision': expected_revision}])
    return {'schema_version': 1, 'removed': identifier}


def edit_row(workspace, identifier, field, value, expected_revision, application_id=None, confirm=False):
    workspace = workspace_path(str(workspace))
    with LOCK:
        data = table(workspace)
        row = next((r for r in data['rows'] if r['vacancy_id'] == identifier), None)
        if row is None:
            raise ValueError('Vacancy no longer exists; reload the table')
        if row['revision'] != expected_revision:
            raise ValueError('This row changed elsewhere. Reload before applying this edit.')
        vacancy = next(item for item in vacancies.query(workspace)['vacancies'] if item['vacancy_id'] == identifier)
        if field in vacancies.EDITABLE or field == 'review':
            vacancies.edit(workspace, identifier, field, value, now())
        elif field in {'applied', 'salary', 'status', 'applied_at', 'next_interview', 'next_interview_at', 'interview_stages', 'application_notes'}:
            aliases = set(vacancy['aliases'])
            for application in row['applications']:
                aliases.add('url:' + evaluate.canonical_url(application['vacancy_link']))
            aliases.add('url:' + evaluate.canonical_url(row['values']['url']))
            details = {'company': row['values'].get('company', ''), 'position': row['values'].get('title', ''),
                       'vacancy_link': row['values']['url'], 'work_type': row['values'].get('work_type', '')}
            old_ids = vacancy['previous_ids']
            changes = {'notes' if field == 'application_notes' else field: value}
            tracking.edit(workspace, identifier, aliases, details, changes, application_id, confirm, old_ids)
        else:
            raise ValueError('This field is read-only')
        return next(r for r in table(workspace)['rows'] if r['vacancy_id'] == identifier)


def find_jobs(workspace, count, progress=lambda message: None, interpreter=codex_bridge.interpret_batch, adapters=None, delay=2.0, max_ai_calls=5, cache_version=None):
    workspace = workspace_path(str(workspace))
    if type(count) is not int or count < 1:
        raise ValueError('Number of new jobs must be a positive integer')
    if type(max_ai_calls) is not int or max_ai_calls < 0:
        raise ValueError('Maximum AI calls must be a nonnegative integer')
    c = search_config.export(workspace)
    c['target_count'] = count
    if 'discovery_budget' in search_config.inspect_config(workspace)['defaults']:
        c['discovery_budget'] = count * 10
    # The coordinator's requested N may exceed an explicit effort limit; search
    # still receives a valid target, and the coordinator reports the shortfall.
    c['target_count'] = min(count, c['discovery_budget'])
    # A requested N overrides only this run. Never silently exceed the configured effort budget.
    c = evaluate.criteria(c)
    if cache_version is None and interpreter is codex_bridge.interpret_batch:
        cache_version = codex_bridge.cache_version()
    usage = dict(ai_calls=0, max_ai_calls=max_ai_calls, ai_listings=0, reused=0, scripted=0, known_skipped=0, deferred=0, prompt_characters=0, reported_tokens={}, calls_with_token_usage=0)
    with LOCK:
        identities = vacancies.known_identities(workspace)
        known = set(identities['identities']) | (set(tracking.known_identities(workspace)['identities']) - set(identities['rediscovery_identities']))
    snapshot = None
    qualified, result, ai_limited = [], None, False
    def report_progress(stage):
        coverage = result['coverage'] if result else {}
        progress(f"{stage} Found {min(count, len(qualified))} of {count} new matches; "
                 f"checked {coverage.get('inspected_count', 0)} of {c['discovery_budget']} listings "
                 f"({coverage.get('rejected_count', 0)} rejected, {coverage.get('clarification_count', 0)} need clarification). "
                 f"AI calls {usage['ai_calls']}/{max_ai_calls}; {usage['reused']} reused, {usage['scripted']} scripted, {usage['known_skipped']} tracked skipped.")
    while True:
        report_progress('Fetching LinkedIn listings…')
        previous = len(snapshot['vacancies']) if snapshot else 0
        snapshot = search.acquire(c, snapshot, min(5, max(1, count - len(qualified))), delay, adapters, stop_at_target=False)
        incoming = snapshot['vacancies'][previous:]
        needed = []
        keys = {id(r): extraction.cache_key(c, r, cache_version) for r in incoming} if cache_version else {}
        cached = vacancies.reusable_facts(workspace, list(keys.values()))['facts'] if keys else {}
        for record in incoming:
            record['facts'] = {}
            key = keys.get(id(record))
            if key in cached:
                record['facts'] = cached[key]
                record['extraction_key'] = key
                usage['reused'] += 1
                continue
            if evaluate.identities(record)[1] & known:
                record['search_skip'] = 'known'
                usage['known_skipped'] += 1
                continue
            prepared = extraction.prepare(c, record, snapshot['observed_at'])
            record['facts'] = prepared['facts']
            if prepared['needs_ai']:
                needed.append(record)
            else:
                usage['scripted'] += 1
                if key and prepared['cacheable']:
                    record['extraction_key'] = key
        if needed and usage['ai_calls'] >= max_ai_calls:
            ai_limited = True
            for record in needed:
                record['search_skip'] = 'ai_limit'
            usage['deferred'] += len(needed)
        elif needed:
            usage['ai_calls'] += 1
            usage['ai_listings'] += len(needed)
            report_progress(f'Codex is assessing {len(needed)} unresolved listings…')
            reply = interpreter(c, deepcopy(needed), None)
            facts = reply.get('facts') if isinstance(reply, dict) else reply
            if not isinstance(facts, list) or len(facts) != len(needed) or any(not isinstance(f, dict) for f in facts):
                raise ValueError('Interpreter returned invalid facts or the wrong number of records')
            if isinstance(reply, dict):
                usage['prompt_characters'] += reply.get('prompt_characters', 0)
                if isinstance(reply.get('usage'), dict) and reply['usage']:
                    usage['calls_with_token_usage'] += 1
                    for name, value in reply['usage'].items():
                        if name.endswith('_tokens') and type(value) is int and value >= 0:
                            usage['reported_tokens'][name] = usage['reported_tokens'].get(name, 0) + value
            for record, annotation in zip(needed, facts):
                for name, value in annotation.items():
                    if name in {'technical', 'preferences'} and isinstance(value, dict):
                        record['facts'].setdefault(name, {}).update(value)
                    else:
                        record['facts'][name] = value
                if keys.get(id(record)):
                    record['extraction_key'] = keys[id(record)]
        snapshot['interpreted_for'] = c
        inspected = evaluate.evaluate(c, snapshot)['coverage']['inspected_count']
        selected_snapshot = {**snapshot, 'vacancies': [r for r in snapshot['vacancies'] if not r.get('search_skip')]}
        result = evaluate.evaluate(c, selected_snapshot)  # Validate current evidence before any history/cache write.
        result['coverage']['inspected_count'] = inspected
        qualified = [r for r in result['assessments'] if r['status'] == 'match' and not (set(r['aliases']) & known)]
        with LOCK:
            imported = vacancies.import_results(vacancies.load(workspace), result)
            if not imported['replayed']:
                vacancies.save(workspace, imported['history'])
        report_progress('Batch saved.')
        if ai_limited or len(qualified) >= count or snapshot['coverage']['stopping_reason'] != 'batch_complete':
            break
    outcome = {'schema_version': 1, 'requested': count, 'found': min(count, len(qualified)),
               'shortfall': max(0, count - len(qualified)), 'vacancy_ids': [r['vacancy_id'] for r in qualified[:count]],
               'coverage': result['coverage']}
    outcome['ai_usage'] = usage
    outcome['coverage']['inspection_limit'] = c['discovery_budget']
    outcome['coverage']['stopping_reason'] = 'target_met' if len(qualified) >= count else 'ai_limit' if ai_limited else snapshot['coverage']['stopping_reason']
    with LOCK:
        search.write(workspace / 'workflow' / 'last-search.json', search.encoded(outcome))
        current = table(workspace)
        lines = ['# Tracked vacancies', '', '| Applied | Company | Role | Fit |', '| --- | --- | --- | --- |']
        for r in current['rows']:
            escaped = lambda value: str(value).replace('|', '\\|').replace('\n', ' ')
            lines.append(f"| {'Yes' if r['applied'] else 'No recorded submission'} | {escaped(r['values'].get('company', ''))} | {escaped(r['values'].get('title', ''))} | {r['fit']} |")
        search.write(workspace / 'workflow' / 'vacancies.md', '\n'.join(lines) + '\n')
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['list', 'find'])
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--count', type=int)
    parser.add_argument('--max-ai-calls', type=int, default=5, help='Maximum AI batches; 0 uses scripts/cache only')
    args = parser.parse_args()
    try:
        result = table(args.workspace) if args.command == 'list' else find_jobs(args.workspace, args.count, max_ai_calls=args.max_ai_calls)
        print(json.dumps(result, ensure_ascii=False))
    except (ValueError, OSError) as exc:
        parser.exit(2, str(exc) + '\n')


if __name__ == '__main__':
    main()

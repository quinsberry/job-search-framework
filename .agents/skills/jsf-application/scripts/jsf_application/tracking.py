"""Direct user edits from the local table; the application skill remains the writer."""

from datetime import datetime, timezone
from pathlib import Path
import shutil
from uuid import uuid4

from .applications import COLUMNS, BUSINESS, STATUSES, read_table, validate_record, write_table
from .search_contract import canonical_url


class ConfirmationRequired(ValueError):
    pass


TRACKING_COLUMNS = ['vacancy_id', 'submitted']
SUBMITTED_STATES = {'applied', 'screening', 'interviewing', 'offer', 'rejected', 'withdraw'}


def submitted(row):
    if row.get('submitted') in {'true', 'false'}:
        return row['submitted'] == 'true'
    return bool(row.get('applied_at')) or row.get('status') in SUBMITTED_STATES


def matches(rows, vacancy_id, aliases, old_ids=()):
    result = []
    for row in rows:
        if row.get('vacancy_id') in {vacancy_id, *old_ids}:
            result.append(row)
        elif not row.get('vacancy_id'):
            url = canonical_url(row['vacancy_link'])
            if 'url:' + url in aliases or 'apply:' + url in aliases:
                result.append(row)
    return result


def records(workspace):
    """Read current candidacy records without exposing CSV layout to callers."""
    return read_table(Path(workspace) / 'applications_table.csv')[1]


def known_identities(workspace):
    result = set()
    for row in records(workspace):
        url = canonical_url(row['vacancy_link'])
        result.update({'url:' + url, 'apply:' + url})
        if row.get('vacancy_id'):
            result.add(row['vacancy_id'])
    return {'schema_version': 1, 'identities': sorted(result)}


def edit(workspace, vacancy_id, aliases, details, changes, application_id=None, confirm=False, old_ids=()):
    path = Path(workspace) / 'applications_table.csv'
    columns, rows = read_table(path)
    allowed = BUSINESS | {'applied'}
    if not isinstance(changes, dict) or not changes or set(changes) - allowed:
        raise ValueError('invalid application edits')
    if any(not isinstance(v, str) for k, v in changes.items() if k != 'applied') or ('applied' in changes and type(changes['applied']) is not bool):
        raise ValueError('application fields must be text; applied must be boolean')
    found = matches(rows, vacancy_id, aliases, old_ids)
    if application_id:
        found = [r for r in found if r.get('application_id') == application_id]
        if len(found) != 1:
            raise ValueError('select a known application for this vacancy')
    if len(found) > 1:
        raise ValueError('select one application before editing this vacancy')
    confirmations = []
    if path.exists() and (any(c not in columns for c in COLUMNS + TRACKING_COLUMNS) or any(not r.get('application_id') for r in rows)):
        confirmations.append('Upgrade the existing application table? A backup will be created and existing values preserved.')
    row = found[0].copy() if found else dict.fromkeys(COLUMNS, '')
    for column in COLUMNS:
        row.setdefault(column, '')
    if not row['application_id']:
        row['application_id'] = str(uuid4())
    if not found:
        row.update({k: details.get(k, '') for k in ('company', 'position', 'work_type', 'vacancy_link')})
        row.update(application_id=str(uuid4()), created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), status='ready')
    row['vacancy_id'] = vacancy_id
    was_submitted = submitted(row)
    row.update({k: v for k, v in changes.items() if k != 'applied'})
    if 'applied' in changes:
        wanted = changes['applied']
        if not wanted and (row['status'] not in {'ready', 'applied'} or row.get('next_interview') or row.get('next_interview_at')):
            confirmations.append('This application has hiring progress. Correct its submission mark to not applied? Interview details will be retained.')
        row['submitted'] = 'true' if wanted else 'false'
        if wanted and row['status'] in {'', 'ready'}:
            row['status'] = 'applied'
        elif not wanted:
            row['status'], row['applied_at'] = 'ready', ''
    elif 'status' in changes:
        row['submitted'] = 'false' if row['status'] == 'ready' else 'true' if row['status'] in SUBMITTED_STATES else str(was_submitted).lower()
        if row['status'] == 'ready':
            if was_submitted:
                confirmations.append('Changing to ready corrects the submission mark and clears the application date. Continue?')
            row['applied_at'] = ''
    else:
        row['submitted'] = str(was_submitted).lower()
    if row['applied_at'] and row['submitted'] != 'true':
        raise ValueError('mark the vacancy applied before setting a submission date')
    validate_record(row, allow_unknown_work_type=True)
    if confirmations and not confirm:
        raise ConfirmationRequired(' '.join(confirmations))
    backup = None
    if path.exists() and (any(c not in columns for c in COLUMNS + TRACKING_COLUMNS) or any(not r.get('application_id') for r in rows)):
        backup = path.with_name(path.name + '.' + uuid4().hex + '.bak')
        shutil.copy2(path, backup)
    final_columns = list(columns or COLUMNS)
    for c in COLUMNS + TRACKING_COLUMNS:
        if c not in final_columns:
            final_columns.append(c)
    for old in rows:
        for c in final_columns:
            old.setdefault(c, '')
        if not old['application_id']:
            old['application_id'] = str(uuid4())
    if found:
        rows[rows.index(found[0])] = row
    else:
        rows.append(row)
    for old in rows:
        for c in final_columns:
            old.setdefault(c, '')
    # Idempotent checkbox retries do not create another candidacy or rewrite the file.
    old_columns, old_rows = read_table(path)
    if (final_columns, rows) != (old_columns, old_rows):
        write_table(path, final_columns, rows)
    return {'application_id': row['application_id'], 'backup': str(backup) if backup else None}

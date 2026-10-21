"""Durable, revisioned guided setup. Specialist helpers own domain changes."""
import base64
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
import threading
import uuid

from . import ai
from . import workflow
from .modules import candidate
from jsf_profile import guided_setup as owner


ACTIVE = {}
TERMINAL = {'complete', 'cancelled'}
MAX_UPLOAD = 10 * 1024 * 1024


def path(workspace, kind):
    return Path(workspace) / 'workflow' / ('setup-' + kind + '-draft.json')


def read(workspace, kind=None):
    if kind:
        candidate.require(kind in {'profile', 'config'}, 'Choose profile or config')
    files = [path(workspace, k) for k in ([kind] if kind else ('profile', 'config'))] + [Path(workspace) / 'workflow' / 'setup-draft.json']
    values = []
    for file in files:
        if not file.exists():
            continue
        value = candidate.read_json(file)
        candidate.require(isinstance(value, dict) and value.get('schema_version') == 1 and value.get('kind') in {'profile', 'config'}, 'Invalid setup draft')
        if file.name == 'setup-draft.json' and path(workspace, value['kind']).exists():
            continue
        if kind is None or value['kind'] == kind:
            values.append((file.stat().st_mtime_ns, value))
    return max(values, key=lambda item: item[0])[1] if values else None


def write(workspace, session):
    session['revision'] = uuid.uuid4().hex
    candidate.atomic_write(path(workspace, session['kind']), candidate.encoded(session))
    return public(session)


def public(session):
    if session is None:
        return None
    fields = ('schema_version', 'id', 'revision', 'kind', 'state', 'message', 'questions', 'review', 'stage', 'existing_sources', 'edited_markdown', 'phase', 'started_at', 'failure_detail')
    result = {key: deepcopy(session[key]) for key in fields if key in session}
    result['can_retry'] = session['state'] == 'failed' and bool(session.get('sources') or session.get('pending_upload'))
    return result


def current(workspace, kind=None):
    with workflow.LOCK:
        session = read(workspace, kind)
        if (session and session['kind'] == 'profile' and session['state'] == 'questions' and 'proposal' in session
                and len(session['questions']) == 1 and session['questions'][0]['id'] == 'corrections'
                and session['questions'][0]['label'] == 'What would you like to correct or add?'):
            session.update(state='review', questions=[], message='Edit your profile draft directly, then review the changes before saving.')
            write(workspace, session)
        if session and session['state'] == 'processing' and session['id'] not in ACTIVE:
            session.update(state='failed', message='Setup was interrupted by a server restart. Your draft and submitted answers are saved. Retry to continue.')
            write(workspace, session)
        if session and session['kind'] == 'profile' and session['state'] in {'review', 'questions'} and 'proposal' in session and not session.get('edited_markdown'):
            preview = owner.profile_review(session['proposal'])
            if session['review'] != preview:
                session['review'] = preview
                write(workspace, session)
        return public(session)


def require_current(workspace, identifier, revision):
    session = next((read(workspace, kind) for kind in ('profile', 'config') if (read(workspace, kind) or {}).get('id') == identifier), None)
    candidate.require(session is not None and session['id'] == identifier and session['revision'] == revision,
                      'Setup changed in another tab. Reopen the current draft before continuing.')
    return session


def start(workspace, kind):
    candidate.require(kind in {'profile', 'config'}, 'Choose profile or search preferences setup')
    with workflow.LOCK:
        prior = read(workspace, kind)
        if prior and prior['state'] not in TERMINAL:
            return current(workspace, kind)
        session = dict(schema_version=1, id=uuid.uuid4().hex, kind=kind, state='questions', stage=0,
                       message='', questions=[], review='', answers={}, transcript=[], sources=[])
        if kind == 'profile':
            context = owner.profile_context(workspace)
            session['base_profile'] = context['profile']
            session['existing_sources'] = context['cv_sources']
            if context['profile'] is not None:
                proposal = candidate.summary(context['profile'])
                proposal['base_revision'] = proposal['revision']
                session.update(state='review', proposal=proposal, review=owner.profile_review(proposal),
                               message='Edit your saved profile. Save validates and records your corrections without AI.')
            else:
                session.update(state='source', message='Choose a PDF or Markdown CV, or reuse an imported CV. Your active profile will stay unchanged until Save.')
        else:
            session['original'] = owner.config_snapshot(workspace)
            session['questions'] = owner.config_questions(session['original'], {}, 0)
            session['message'] = owner.GROUP_TITLES[0]
        return write(workspace, session)


def launch(workspace, session):
    event = threading.Event()
    reading = bool(session.get('pending_upload'))
    session.pop('failure_detail', None)
    session.update(state='processing', phase='reading' if reading else 'preparing',
                   started_at=datetime.now(timezone.utc).isoformat(),
                   message='Reading your document…' if reading else f'Preparing your profile with {ai.label()}…', questions=[])
    ACTIVE[session['id']] = event
    result = write(workspace, session)
    worker = threading.Thread(target=process_profile, args=(workspace, deepcopy(session), event), daemon=True)
    worker.start()
    return result


def progress(workspace, snapshot, event, phase, message):
    with workflow.LOCK:
        live = read(workspace, snapshot['kind'])
        if event.is_set() or not live or (live['id'], live['revision']) != (snapshot['id'], snapshot['revision']):
            return False
        snapshot.update(phase=phase, message=message)
        # Progress does not change answers or invalidate an in-flight Cancel request.
        candidate.atomic_write(path(workspace, snapshot['kind']), candidate.encoded(snapshot))
        return True


def process_profile(workspace, snapshot, event):
    try:
        if snapshot.get('pending_upload'):
            snapshot['sources'] = [candidate.import_source(workspace, snapshot['pending_upload'])]
            snapshot.pop('pending_upload')
        if not progress(workspace, snapshot, event, 'preparing', f'Preparing your profile with {ai.label()}…'):
            raise ValueError('Setup cancelled or replaced')
        response = ai.guided_profile(owner.profile_prompt(snapshot['base_profile'], snapshot['sources'], snapshot['transcript']), event)
        if not progress(workspace, snapshot, event, 'validating', 'Checking your profile draft…'):
            raise ValueError('Setup cancelled or replaced')
        candidate.require(isinstance(response, dict) and isinstance(response.get('message'), str), 'Invalid guided setup response')
        questions = response.get('questions')
        candidate.require(isinstance(questions, list) and len(questions) <= 6, 'The AI returned too many or invalid questions')
        seen = set()
        for q in questions:
            candidate.require(isinstance(q, dict) and set(q) == {'id', 'label', 'help', 'type', 'required', 'options'}, 'Invalid setup question')
            candidate.require(isinstance(q['id'], str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}', q['id']) and q['id'] not in seen, 'Questions need unique IDs')
            seen.add(q['id'])
            candidate.string(q['label'], 'Question label')
            candidate.require(isinstance(q['help'], str) and type(q['required']) is bool and q['type'] in {'text', 'single', 'multi'}, 'Invalid question fields')
            candidate.string_list(q['options'], 'Question options')
        proposal = owner.profile_plan(snapshot['base_profile'], snapshot['sources'], response['changes_json'])
        skipped_ids, skipped_labels = set(), set()
        for turn in snapshot['transcript']:
            for old in turn.get('questions', []):
                if not turn['answers'].get(old['id']):
                    skipped_ids.add(old['id'])
                    skipped_labels.add(candidate.normalized(old['label']))
        questions = [q for q in questions if q['id'] not in skipped_ids and candidate.normalized(q['label']) not in skipped_labels]
        if proposal['outcome'] != 'needs_clarification':
            for q in questions:
                q['required'] = False
        candidate.require(questions or proposal['outcome'] != 'needs_clarification', 'No supported CV facts were found. Choose a readable CV or supply clarifying answers.')
        preview = owner.profile_review(proposal)
        snapshot.update(state='questions' if questions else 'review', message=response['message'], questions=questions,
                        phase='ready', proposal=proposal, review=preview)
        snapshot.pop('edited_markdown', None)
    except Exception as exc:
        detail = str(exc)
        message = ('Preparing your profile took too long. Your CV and answers are saved. Try again when you’re ready.'
                   if 'timed out' in detail.lower() else
                   'We couldn’t finish reading your document. Choose a readable PDF or Markdown CV, or retry.'
                   if snapshot.get('pending_upload') else
                   'We couldn’t prepare your profile. Your CV and answers are saved. Check your connection or AI sign-in, then retry.')
        snapshot.update(state='failed', phase='failed', message=message, failure_detail=detail)
    with workflow.LOCK:
        live = read(workspace, snapshot['kind'])
        if live and live['id'] == snapshot['id'] and live['revision'] == snapshot['revision'] and not event.is_set():
            write(workspace, snapshot)
        ACTIVE.pop(snapshot['id'], None)


def choose_source(workspace, identifier, revision, source_id=None, upload=None):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['kind'] == 'profile' and session['state'] in {'source', 'failed'}, 'This setup is not waiting for a CV')
        if upload is not None:
            candidate.require(isinstance(upload, dict) and set(upload) == {'name', 'data'}, 'Choose a CV file')
            name = upload['name']
            candidate.require(isinstance(name, str) and Path(name).name == name and '\\' not in name and name not in {'.', '..'}, 'Invalid CV filename')
            candidate.require(Path(name).suffix.lower() in {'.md', '.pdf'}, 'Choose a PDF or Markdown CV')
            candidate.require(isinstance(upload['data'], str) and len(upload['data']) <= (MAX_UPLOAD * 4 // 3 + 4), 'CV must be under 10 MB')
            try:
                raw = base64.b64decode(upload['data'], validate=True)
            except ValueError:
                raise ValueError('Invalid CV upload') from None
            candidate.require(0 < len(raw) <= MAX_UPLOAD, 'Choose a nonempty CV under 10 MB')
            directory = Path(workspace) / 'workflow' / 'setup-inputs' / session['id']
            directory.mkdir(parents=True, exist_ok=True)
            file = directory / name
            file.write_bytes(raw)
            session['pending_upload'] = str(file)
            source = None
        else:
            source = owner.select_cv(session['base_profile'], source_id, workspace)
            session.pop('pending_upload', None)
        session['sources'] = [source] if source else []
        session['transcript'] = []
        return launch(workspace, session)


def answer(workspace, identifier, revision, answers):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['state'] == 'questions', 'This setup is not waiting for answers')
        if session['kind'] == 'config':
            accepted = owner.accept_config_answers(session['original'], session['answers'], session['stage'], answers)
            stage = session['stage'] + 1
            if stage == len(owner.GROUPS):
                try:
                    proposal = owner.config_plan(session['original'], accepted)
                except ValueError as exc:
                    session.update(answers=accepted, questions=owner.config_questions(session['original'], accepted, session['stage']),
                                   message=str(exc) + ' Use Back to revise an earlier choice if needed.')
                    return write(workspace, session)
                session.update(state='review', proposal=proposal, review=owner.config_review(proposal), message='Review your search preferences. Save applies these choices; it does not start a search.')
            else:
                session.update(stage=stage, questions=owner.config_questions(session['original'], accepted, stage), message=owner.GROUP_TITLES[stage])
            session['answers'] = accepted
            return write(workspace, session)
        questions = session['questions']
        candidate.require(isinstance(answers, dict) and set(answers) == {q['id'] for q in questions}, 'Answer the current questions')
        for q in questions:
            value = answers[q['id']]
            candidate.require(isinstance(value, str) or (isinstance(value, list) and all(isinstance(x, str) for x in value)), 'Invalid answer')
            candidate.require(len(str(value)) <= 20000, 'Answer is too long')
            if q['required']:
                candidate.require(bool(value) and (not isinstance(value, str) or bool(value.strip())), q['label'] + ' needs an answer')
        source = owner.user_source(answers)
        if source:
            session['sources'].append(source)
        session['transcript'].append({'questions': questions, 'answers': answers})
        return launch(workspace, session)


def retry(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['state'] == 'failed' and session['kind'] == 'profile' and (session['sources'] or session.get('pending_upload')), 'Choose a CV before retrying')
        return launch(workspace, session)


def back(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['kind'] == 'config' and session['state'] == 'questions' and session['stage'] > 0, 'No earlier setup step')
        session['stage'] -= 1
        session.update(questions=owner.config_questions(session['original'], session['answers'], session['stage']),
                       message=owner.GROUP_TITLES[session['stage']])
        return write(workspace, session)


def edit(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['state'] == 'review', 'Only a draft awaiting review can be revised')
        if session['kind'] == 'config':
            session.update(stage=0, state='questions', questions=owner.config_questions(session['original'], session['answers'], 0), message=owner.GROUP_TITLES[0])
        else:
            session.update(state='review', questions=[], message='Edit your profile draft directly, then review the changes before saving.')
        return write(workspace, session)


def markdown(workspace, identifier, revision, text):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['kind'] == 'profile' and session['state'] in {'review', 'failed'} and 'proposal' in session, 'Only an interpreted profile draft can be edited')
        if text == session['review']:
            return public(session)
        proposal = candidate.edit_plan(session['proposal']['profile'], text, session['proposal']['base_revision'])
        session.update(proposal=proposal, review=owner.profile_review(proposal), state='review',
                       message='Edits validated. Save applies your profile without AI.')
        return write(workspace, session)


def import_cv(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['kind'] == 'profile' and session['state'] == 'review', 'Open the profile editor before importing a CV')
        session.update(state='source', message='Choose a new CV or reuse an imported CV.',
                       existing_sources=owner.profile_context(workspace)['cv_sources'])
        return write(workspace, session)


def save(workspace, identifier, revision, text=None):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        if session['state'] == 'complete':
            return public(session)
        candidate.require(session['state'] == 'review', 'Review the completed draft before saving')
        if session['kind'] == 'profile':
            proposal = session['proposal']
            if text is not None and text != session['review']:
                proposal = candidate.edit_plan(proposal['profile'], text, proposal['base_revision'])
            owner.save_profile(workspace, proposal)
        else:
            owner.save_config(workspace, session['proposal'])
        # Keep a receipt, not a second authoritative profile/configuration.
        receipt = dict(schema_version=1, id=session['id'], kind=session['kind'], state='complete',
                       message='Saved candidate/profile.md.' if session['kind'] == 'profile' else 'Saved search preferences.', questions=[], review='')
        return write(workspace, receipt)


def rebase(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['state'] == 'review', 'Only a review draft can be refreshed')
        if session['kind'] == 'profile':
            current_profile = owner.profile_context(workspace)['profile']
            candidate.require(current_profile is not None, 'Active profile is missing')
            # Refuse to guess how concurrent professional edits should merge.
            proposal = candidate.summary(current_profile)
            proposal['base_revision'] = proposal['revision']
            session.update(base_profile=current_profile, proposal=proposal, review=owner.profile_review(proposal),
                           message='Current saved profile loaded. Apply your intended changes to this version.')
            return write(workspace, session)
        session['original'] = owner.config_snapshot(workspace)
        session.update(stage=0, state='questions', questions=owner.config_questions(session['original'], session['answers'], 0),
                       message='Current file loaded. Review your earlier answers against it before saving.')
        return write(workspace, session)


def cancel(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['state'] not in TERMINAL, 'This setup has already finished')
        event = ACTIVE.get(identifier)
        if event:
            event.set()
        directory = Path(workspace) / 'workflow' / 'setup-inputs' / identifier
        referenced = owner.source_directory_in_use(workspace, directory)
        if not referenced:
            shutil.rmtree(directory, ignore_errors=True)
        receipt = dict(schema_version=1, id=identifier, kind=session['kind'], state='cancelled',
                       message='Draft discarded. Cancelling did not modify your active profile, preferences or tracked jobs.' + (' Uploaded source files were kept to preserve source history.' if referenced else ''), questions=[], review='')
        return write(workspace, receipt)

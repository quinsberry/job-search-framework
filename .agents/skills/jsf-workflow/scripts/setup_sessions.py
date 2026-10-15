"""Durable, revisioned guided setup. Specialist helpers own domain changes."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import re
import shutil
import threading
import uuid

import codex_bridge
import workflow
from modules import candidate
import guided_setup as owner


ACTIVE = {}
TERMINAL = {'complete', 'cancelled'}
MAX_UPLOAD = 10 * 1024 * 1024


def path(workspace):
    return Path(workspace) / 'workflow' / 'setup-draft.json'


def read(workspace):
    file = path(workspace)
    if not file.exists():
        return None
    value = candidate.read_json(file)
    candidate.require(isinstance(value, dict) and value.get('schema_version') == 1, 'Invalid setup draft')
    return value


def write(workspace, session):
    session['revision'] = uuid.uuid4().hex
    candidate.atomic_write(path(workspace), candidate.encoded(session))
    return public(session)


def public(session):
    if session is None:
        return None
    fields = ('schema_version', 'id', 'revision', 'kind', 'state', 'message', 'questions', 'review', 'stage', 'existing_sources')
    return {key: deepcopy(session[key]) for key in fields if key in session}


def current(workspace):
    with workflow.LOCK:
        session = read(workspace)
        if session and session['state'] == 'processing' and session['id'] not in ACTIVE:
            session.update(state='failed', message='Setup was interrupted by a server restart. Your draft and submitted answers are saved. Retry to continue.')
            write(workspace, session)
        return public(session)


def require_current(workspace, identifier, revision):
    session = read(workspace)
    candidate.require(session is not None and session['id'] == identifier and session['revision'] == revision,
                      'Setup changed in another tab. Reopen the current draft before continuing.')
    return session


def start(workspace, kind):
    candidate.require(kind in {'profile', 'config'}, 'Choose profile or search preferences setup')
    with workflow.LOCK:
        prior = read(workspace)
        candidate.require(not prior or prior['state'] in TERMINAL, 'This workspace already has an unfinished setup. Continue or cancel it first.')
        session = dict(schema_version=1, id=uuid.uuid4().hex, kind=kind, state='questions', stage=0,
                       message='', questions=[], review='', answers={}, transcript=[], sources=[])
        if kind == 'profile':
            existing = candidate.load(workspace)
            session['base_profile'] = existing
            session['existing_sources'] = [{'id': key, 'name': source['name']} for key, source in (existing or {}).get('sources', {}).items() if source['kind'] == 'cv']
            session.update(state='source', message='Choose a PDF or Markdown CV, or reuse an imported CV. Your active profile will stay unchanged until Save.')
        else:
            session['original'] = owner.config_snapshot(workspace)
            session['questions'] = owner.config_questions(session['original'], {}, 0)
            session['message'] = owner.GROUP_TITLES[0]
        return write(workspace, session)


def launch(workspace, session):
    event = threading.Event()
    session.update(state='processing', message='Reading your CV and preparing the next step…', questions=[])
    ACTIVE[session['id']] = event
    result = write(workspace, session)
    worker = threading.Thread(target=process_profile, args=(workspace, deepcopy(session), event), daemon=True)
    worker.start()
    return result


def process_profile(workspace, snapshot, event):
    try:
        response = codex_bridge.guided_profile(owner.profile_prompt(snapshot['base_profile'], snapshot['sources'], snapshot['transcript']), event)
        candidate.require(isinstance(response, dict) and isinstance(response.get('message'), str), 'Invalid guided setup response')
        questions = response.get('questions')
        candidate.require(isinstance(questions, list) and len(questions) <= 6, 'Codex returned too many or invalid questions')
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
            for old in turn['questions']:
                if not turn['answers'].get(old['id']):
                    skipped_ids.add(old['id'])
                    skipped_labels.add(candidate.normalized(old['label']))
        questions = [q for q in questions if q['id'] not in skipped_ids and candidate.normalized(q['label']) not in skipped_labels]
        if proposal['outcome'] != 'needs_clarification':
            for q in questions:
                q['required'] = False
        candidate.require(questions or proposal['outcome'] != 'needs_clarification', 'No supported CV facts were found. Choose a readable CV or supply clarifying answers.')
        preview = '\n'.join(line for line in candidate.render(proposal['profile']).splitlines()
                            if not line.startswith('Generated from candidate/profile.yaml.'))
        snapshot.update(state='questions' if questions else 'review', message=response['message'], questions=questions,
                        proposal=proposal, review=preview)
    except Exception as exc:
        snapshot.update(state='failed', message=str(exc))
    with workflow.LOCK:
        live = read(workspace)
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
            extracted = candidate.extract(file)
            candidate.require(extracted['outcome'] != 'needs_clarification', 'No readable text was found. Choose a text PDF or Markdown CV; OCR is not available.')
            source = extracted['source']
        else:
            registry = (session['base_profile'] or {}).get('sources', {})
            candidate.require(isinstance(source_id, str) and source_id in registry and registry[source_id]['kind'] == 'cv', 'Choose an imported CV or upload a new one')
            source = registry[source_id]
        session['sources'] = [source]
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
        candidate.require(session['state'] == 'failed' and session['kind'] == 'profile' and session['sources'], 'Choose a CV before retrying')
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
            session.update(state='questions', questions=[dict(id='corrections', label='What would you like to correct or add?', help='Only provide professional facts you want recorded. Leave blank to keep the draft.', type='text', required=False, options=[])], message='Add a correction, then review the updated profile.')
        return write(workspace, session)


def save(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        if session['state'] == 'complete':
            return public(session)
        candidate.require(session['state'] == 'review', 'Review the completed draft before saving')
        if session['kind'] == 'profile':
            if candidate.load(workspace) == session['proposal']['profile']:
                candidate.persist(workspace, session['proposal']['profile'])
            else:
                candidate.apply_plan(workspace, session['proposal'])
        else:
            owner.save_config(workspace, session['proposal'])
        # Keep a receipt, not a second authoritative profile/configuration.
        receipt = dict(schema_version=1, id=session['id'], kind=session['kind'], state='complete',
                       message='Saved profile and readable summary.' if session['kind'] == 'profile' else 'Saved search preferences.', questions=[], review='')
        return write(workspace, receipt)


def rebase(workspace, identifier, revision):
    with workflow.LOCK:
        session = require_current(workspace, identifier, revision)
        candidate.require(session['state'] == 'review', 'Only a review draft can be refreshed')
        if session['kind'] == 'profile':
            session['base_profile'] = candidate.load(workspace)
            return launch(workspace, session)
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
        try:
            profile = candidate.load(workspace)
            referenced = any(source.get('path') and Path(source['path']).resolve().parent == directory.resolve() for source in (profile or {}).get('sources', {}).values())
        except (ValueError, OSError):
            referenced = directory.exists()
        if not referenced:
            shutil.rmtree(directory, ignore_errors=True)
        receipt = dict(schema_version=1, id=identifier, kind=session['kind'], state='cancelled',
                       message='Draft discarded. Cancelling did not modify your active profile, preferences or tracked jobs.' + (' Uploaded source files were kept to preserve source history.' if referenced else ''), questions=[], review='')
        return write(workspace, receipt)

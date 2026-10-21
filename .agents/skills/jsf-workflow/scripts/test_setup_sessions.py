import base64
import json
from pathlib import Path
import tempfile
import threading
import time
import sys
import subprocess
import unittest
from unittest.mock import patch

from jsf_workflow import setup_sessions as sessions
from jsf_workflow import claude_bridge, codex_bridge
from jsf_profile import guided_setup as owner
from jsf_workflow.modules import candidate, search_config
import test_workflow as fixtures


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.WorkflowTests()
        self.fixture.setUp()
        self.workspace = self.fixture.workspace

    def tearDown(self):
        self.fixture.tearDown()

    def call(self, action, session, *args, **kwargs):
        return getattr(sessions, action)(self.workspace, session['id'], session['revision'], *args, **kwargs)

    def completed_profile(self, prompt, cancel=None):
        return dict(message='Review supported facts.', questions=[], changes_json=candidate.encoded({'schema_version': 1, 'sources': [], 'records': []}))

    def wait(self):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            current = sessions.current(self.workspace)
            if current['state'] != 'processing':
                return current
            time.sleep(.01)
        self.fail('Worker did not finish')

    def fill_config(self, session):
        replacements = {'titles': ['frontend engineer'], 'target_count': 5, 'seniorities': None,
                        'work_arrangements': ['remote'], 'candidate.country': 'Poland', 'compensation': None,
                        'technical.required': []}
        while session['state'] == 'questions':
            answers = {q['id']: replacements.get(q['id'], q['value'] if q['value'] != search_config.FILL else None) for q in session['questions']}
            session = self.call('answer', session, answers)
        return session

    def test_config_draft_resume_cancel_and_explicit_save_preserve_comments(self):
        original = self.workspace / 'search-config.yml'
        original.write_text('# Keep my comment\n' + original.read_text())
        before = original.read_bytes()
        session = sessions.start(self.workspace, 'config')
        profile_draft = sessions.start(self.workspace, 'profile')
        self.assertEqual(profile_draft['kind'], 'profile')
        self.assertEqual(sessions.current(self.workspace, 'config'), session)
        review = self.fill_config(session)
        self.assertEqual(review['state'], 'review')
        self.assertEqual(original.read_bytes(), before)
        self.assertEqual(sessions.current(self.workspace), review)
        cancelled = self.call('cancel', review)
        self.assertEqual(cancelled['state'], 'cancelled')
        self.assertEqual(original.read_bytes(), before)
        review = self.fill_config(sessions.start(self.workspace, 'config'))
        saved = self.call('save', review)
        self.assertEqual(saved['state'], 'complete')
        self.assertEqual(search_config.export(self.workspace)['target_count'], 5)
        self.assertTrue(original.read_text().startswith('# Keep my comment'))
        self.assertNotIn('proposal', sessions.read(self.workspace))
        self.assertEqual(self.call('save', saved), saved)

    def test_config_template_can_be_completed_without_creating_profile(self):
        with tempfile.TemporaryDirectory() as root:
            self.workspace = Path(root)
            review = self.fill_config(sessions.start(self.workspace, 'config'))
            self.assertFalse((self.workspace / 'search-config.yml').exists())
            self.call('save', review)
            self.assertFalse((self.workspace / 'candidate').exists())
            self.assertEqual(search_config.inspect_config(self.workspace)['profile_status'], 'missing')

    def test_stale_tabs_and_external_config_changes_are_rejected_and_rebasable(self):
        session = sessions.start(self.workspace, 'config')
        review = self.fill_config(session)
        with self.assertRaisesRegex(ValueError, 'another tab'):
            self.call('cancel', session)
        path = self.workspace / 'search-config.yml'
        path.write_text('# External edit\n' + path.read_text())
        changed = path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'changed while setup'):
            self.call('save', review)
        self.assertEqual(path.read_bytes(), changed)
        reloaded = self.call('rebase', review)
        review = self.fill_config(reloaded)
        self.call('save', review)
        self.assertTrue(path.read_text().startswith('# External edit'))

    def test_missing_required_answers_do_not_advance_or_write_config(self):
        session = sessions.start(self.workspace, 'config')
        before = (self.workspace / 'search-config.yml').read_bytes()
        with self.assertRaisesRegex(ValueError, 'current questions'):
            self.call('answer', session, {})
        self.assertEqual(sessions.current(self.workspace), session)
        self.assertEqual((self.workspace / 'search-config.yml').read_bytes(), before)

    def test_profile_reuses_cv_reviews_and_only_saves_after_explicit_action(self):
        before = (self.workspace / 'candidate/profile.md').read_bytes()
        session = self.call('import_cv', sessions.start(self.workspace, 'profile'))
        source = session['existing_sources'][0]['id']
        with patch('jsf_workflow.setup_sessions.ai.guided_profile', side_effect=self.completed_profile):
            self.call('choose_source', session, source_id=source)
            review = self.wait()
        self.assertEqual(review['state'], 'review')
        self.assertEqual((self.workspace / 'candidate/profile.md').read_bytes(), before)
        self.assertEqual(self.call('save', review)['state'], 'complete')
        self.assertEqual((self.workspace / 'candidate/profile.md').read_bytes(), before)

    def test_new_markdown_upload_and_user_answers_are_grounded(self):
        raw = b'Grace Example. TypeScript.'
        def interpret(prompt, cancel=None):
            data = json.loads(prompt.split('\n\nDATA\n')[-1])
            sources = data['sources']
            name = dict(value='Grace Example', evidence=[dict(source_id=sources[0]['id'], page=1, quote='Grace Example')])
            facts = {'full_name': name}
            if len(sources)>1:
                facts['location'] = dict(value='Poland', evidence=[dict(source_id=sources[-1]['id'], page=1, quote='Poland')])
            return dict(message='Please confirm missing information.' if len(sources)==1 else 'Review profile.',
                        questions=[dict(id='location', label='Where do you live?', help='', type='text', required=True, options=[])] if len(sources)==1 else [],
                        changes_json=candidate.encoded(dict(schema_version=1, sources=[], records=[dict(id='identity', section='identity', facts=facts)])))
        # Start from a workspace without professional facts.
        with tempfile.TemporaryDirectory() as root:
            self.workspace=Path(root)
            session=sessions.start(self.workspace,'profile')
            with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=interpret):
                self.call('choose_source',session,upload=dict(name='CV.md',data=base64.b64encode(raw).decode()))
                questions=self.wait()
                self.assertEqual(questions['state'],'questions')
                self.assertFalse(questions['questions'][0]['required'])
                self.call('answer',questions,{'location':'Poland'})
                review=self.wait()
            self.assertEqual(review['state'],'review',review['message'])
            self.assertFalse((self.workspace/'candidate/profile.md').exists())
            self.call('save',review)
            profile=candidate.load(self.workspace)
            self.assertEqual(profile['records'][0]['facts']['location']['value'],'Poland')
            self.assertTrue(any(s['kind']=='user' for s in profile['sources'].values()))

    def test_bad_evidence_fails_without_saving_and_can_retry(self):
        def bad(prompt,cancel=None):
            return dict(message='Review',questions=[],changes_json=json.dumps(dict(schema_version=1,sources=[],records=[dict(id='identity',section='identity',facts={'full_name':dict(value='Invented',evidence=[dict(source_id='0'*64,page=1,quote='Invented')])})])))
        before=(self.workspace/'candidate/profile.md').read_bytes()
        session=self.call('import_cv', sessions.start(self.workspace,'profile'))
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=bad):
            self.call('choose_source',session,source_id=session['existing_sources'][0]['id'])
            failed=self.wait()
        self.assertEqual(failed['state'],'failed')
        self.assertEqual((self.workspace/'candidate/profile.md').read_bytes(),before)
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=self.completed_profile):
            self.call('retry',failed)
            self.assertEqual(self.wait()['state'],'review')

    def test_cancel_running_turn_ignores_late_result_and_deletes_uploaded_draft(self):
        started,release=threading.Event(),threading.Event()
        def slow(prompt,cancel=None):
            started.set();release.wait(2)
            return self.completed_profile(prompt)
        session=self.call('import_cv', sessions.start(self.workspace,'profile'))
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=slow):
            processing=self.call('choose_source',session,upload={'name':'CV.md','data':base64.b64encode(b'Ada Example').decode()})
            self.assertTrue(started.wait(1))
            cancelled=self.call('cancel',processing)
            release.set()
            deadline=time.monotonic()+2
            while session['id'] in sessions.ACTIVE and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(sessions.current(self.workspace),cancelled)
        self.assertFalse((self.workspace/'workflow/setup-inputs'/session['id']).exists())
        self.assertNotIn('sources',sessions.read(self.workspace))

    def test_restart_marks_processing_as_retryable_without_losing_answers(self):
        session=self.call('import_cv', sessions.start(self.workspace,'profile'))
        stored=sessions.read(self.workspace)
        stored.update(state='processing',transcript=[{'questions':[],'answers':{}}])
        sessions.write(self.workspace,stored)
        current=sessions.current(self.workspace)
        self.assertEqual(current['state'],'failed')
        self.assertIn('restart',current['message'])
        self.assertEqual(sessions.read(self.workspace)['transcript'],stored['transcript'])

    def test_upload_rejects_traversal_unreadable_and_invalid_base64(self):
        session=self.call('import_cv', sessions.start(self.workspace,'profile'))
        for upload in [dict(name='../CV.md',data='YQ=='),dict(name='CV.md',data='not base64')]:
            with self.assertRaises(ValueError):self.call('choose_source',session,upload=upload)
        self.assertEqual(sessions.current(self.workspace)['state'],'source')
        self.call('choose_source',session,upload=dict(name='CV.md',data=base64.b64encode(b' ').decode()))
        failed=self.wait()
        self.assertEqual(failed['state'],'failed')
        self.assertIn('readable',failed['message'])

    def test_cross_field_error_can_be_repaired_with_back_and_retains_final_answers(self):
        session=sessions.start(self.workspace,'config')
        while session['stage']<3:
            answers={q['id']:q['value'] for q in session['questions']}
            if session['stage']==2:
                answers.update({'technical.required':['React'],'technical.excluded':['React']})
            session=self.call('answer',session,answers)
        answers={q['id']:q['value'] for q in session['questions']}
        answers['company_exclusions']=['Example Company']
        blocked=self.call('answer',session,answers)
        self.assertEqual(blocked['state'],'questions')
        self.assertIn('both wanted and excluded',blocked['message'])
        prior=self.call('back',blocked)
        answers={q['id']:q['value'] for q in prior['questions']}
        answers['technical.excluded']=[]
        final=self.call('answer',prior,answers)
        self.assertEqual(next(q['value'] for q in final['questions'] if q['id']=='company_exclusions'),['Example Company'])
        review=self.call('answer',final,{q['id']:q['value'] for q in final['questions']})
        self.assertEqual(review['state'],'review')
        self.call('save',review)
        self.assertEqual(search_config.export(self.workspace)['company_exclusions'],['example company'])

    def test_cancelling_after_interrupted_save_keeps_referenced_source(self):
        session=self.call('import_cv', sessions.start(self.workspace,'profile'))
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=self.completed_profile):
            self.call('choose_source',session,upload={'name':'Updated.md','data':base64.b64encode(b'Ada Example. Updated CV.').decode()})
            review=self.wait()
        real_write=candidate.atomic_write
        def fail_summary(path,content):
            if path.name=='profile.md':raise OSError('Disk unavailable')
            return real_write(path,content)
        with patch('jsf_workflow.setup_sessions.candidate.atomic_write',side_effect=fail_summary):
            with self.assertRaises(OSError):self.call('save',review)
        self.call('cancel',review)
        source=next(s for s in candidate.sources(self.workspace) if s['name']=='Updated.md')
        self.assertTrue(Path(source['path']).exists())

    def test_guided_cancellation_terminates_the_subprocess_for_each_provider(self):
        for bridge in (codex_bridge,claude_bridge):
            with self.subTest(provider=bridge.CLI):
                event,started=threading.Event(),threading.Event()
                real_popen=subprocess.Popen
                processes=[];errors=[]
                def sleeping_process(command,**kwargs):
                    self.assertEqual(command[0],bridge.CLI)
                    process=real_popen([sys.executable,'-c','import sys,time; sys.stdin.read(); time.sleep(30)'],**kwargs)
                    processes.append(process);started.set();return process
                def invoke():
                    try:bridge.guided_profile('Fictional CV',event)
                    except ValueError as exc:errors.append(str(exc))
                with patch.object(bridge,'status',return_value={'ready':True}),patch('jsf_workflow.bridge_common.subprocess.Popen',side_effect=sleeping_process):
                    worker=threading.Thread(target=invoke)
                    worker.start();self.assertTrue(started.wait(1));event.set();worker.join(5)
                self.assertFalse(worker.is_alive())
                self.assertIsNotNone(processes[0].poll())
                self.assertIn('cancelled',errors[0])

    def test_guided_claude_turn_returns_only_validated_structured_output(self):
        answer={'message':'Thanks','questions':[],'changes_json':'{}'}
        class Process:
            def __init__(self,stdout,code):self.stdout,self.returncode,self.pid=stdout,code,0
            def __enter__(self):return self
            def __exit__(self,*exc):return False
            def communicate(self,input=None,timeout=None):return self.stdout,''
        outputs=[(json.dumps({'type':'result','is_error':False,'structured_output':answer}),0),
                 (json.dumps({'type':'result','is_error':False,'result':'I cannot help'}),0),('not json',1)]
        def popen(command,**kwargs):
            self.assertIn('--json-schema',command)
            self.assertEqual(command[command.index('--tools')+1],'')
            self.assertNotIn('ANTHROPIC_API_KEY',kwargs['env'])
            return Process(*outputs.pop(0))
        with patch.dict('os.environ',{'ANTHROPIC_API_KEY':'test'}),patch.object(claude_bridge,'status',return_value={'ready':True}),patch('jsf_workflow.bridge_common.subprocess.Popen',side_effect=popen):
            self.assertEqual(claude_bridge.guided_profile('Fictional CV'),answer)
            for _ in range(2):
                with self.assertRaisesRegex(ValueError,'Claude Code could not complete setup'):
                    claude_bridge.guided_profile('Fictional CV')

    def test_saved_profile_opens_directly_and_manual_save_needs_no_codex(self):
        before=(self.workspace/'candidate/profile.md').read_bytes()
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=AssertionError('No AI for editing')):
            review=sessions.start(self.workspace,'profile')
            self.assertEqual(review['state'],'review')
            edited=review['review'].replace('**Full Name:** Ada Example','**Full Name:** Ada Updated')
            self.assertEqual((self.workspace/'candidate/profile.md').read_bytes(),before)
            self.call('save',review,text=edited)
        identity=candidate.load(self.workspace)['records'][0]
        self.assertEqual(identity['facts']['full_name']['value'],'Ada Updated')
        self.assertTrue(identity['facts']['full_name']['user_corrected'])

    def test_invalid_markdown_preserves_draft_and_active_profile(self):
        review=sessions.start(self.workspace,'profile')
        before=(self.workspace/'candidate/profile.md').read_bytes()
        self.assertEqual(self.call('markdown',review,review['review']),review)
        with self.assertRaisesRegex(ValueError,'Profile line'):
            self.call('save',review,text=review['review']+'\nUnsupported prose')
        self.assertEqual(sessions.current(self.workspace,'profile'),review)
        self.assertEqual((self.workspace/'candidate/profile.md').read_bytes(),before)

    def test_existing_revision_question_resumes_as_an_editable_review(self):
        session=self.call('import_cv', sessions.start(self.workspace,'profile'))
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=self.completed_profile):
            self.call('choose_source',session,source_id=session['existing_sources'][0]['id'])
            review=self.wait()
        legacy=sessions.read(self.workspace)
        legacy.update(state='questions',questions=[dict(id='corrections',label='What would you like to correct or add?',help='',type='text',required=False,options=[])])
        sessions.write(self.workspace,legacy)
        resumed=sessions.current(self.workspace)
        self.assertEqual(resumed['state'],'review')
        self.assertEqual(resumed['review'],review['review'])
        self.assertEqual(self.call('edit',resumed)['state'],'review')

    def test_cancelled_cv_upload_remains_reusable_without_changing_profile(self):
        before=candidate.load(self.workspace)
        session=self.call('import_cv',sessions.start(self.workspace,'profile'))
        with patch('jsf_workflow.setup_sessions.ai.guided_profile',side_effect=self.completed_profile):
            self.call('choose_source',session,upload=dict(name='Reusable.md',data=base64.b64encode(b'Reusable CV text').decode()))
            review=self.wait()
        self.call('cancel',review)
        source=next(s for s in candidate.sources(self.workspace) if s['name']=='Reusable.md')
        self.assertTrue(Path(source['path']).exists())
        self.assertEqual(candidate.load(self.workspace),before)
        reopened=self.call('import_cv',sessions.start(self.workspace,'profile'))
        self.assertIn(source['id'],[s['id'] for s in reopened['existing_sources']])
        self.assertEqual(owner.select_cv(None,source['id'],self.workspace),source)

    def test_legacy_single_draft_is_routed_by_kind_and_resumed_safely(self):
        session=sessions.start(self.workspace,'profile')
        original=sessions.path(self.workspace,'profile')
        original.rename(self.workspace/'workflow/setup-draft.json')
        config=sessions.start(self.workspace,'config')
        self.assertEqual(config['kind'],'config')
        self.assertEqual(sessions.start(self.workspace,'profile')['id'],session['id'])
        self.call('save',session)
        self.assertEqual(sessions.current(self.workspace,'config')['id'],config['id'])


    def test_reading_is_async_and_cancellable_before_ai(self):
        started,release=threading.Event(),threading.Event()
        real_import=candidate.import_source
        def slow_import(*args):
            started.set();release.wait(2)
            return real_import(*args)
        session=self.call('import_cv',sessions.start(self.workspace,'profile'))
        original=candidate.load(self.workspace)
        with patch.object(candidate,'import_source',side_effect=slow_import),patch.object(sessions.ai,'guided_profile',side_effect=AssertionError('Cancelled import must not call AI')):
            processing=self.call('choose_source',session,upload=dict(name='CV.md',data=base64.b64encode(b'Example CV').decode()))
            self.assertTrue(started.wait(1))
            self.assertEqual(processing['phase'],'reading')
            self.assertIn('started_at',processing)
            config=sessions.start(self.workspace,'config')
            self.assertEqual(config['kind'],'config')
            cancelled=self.call('cancel',processing)
            release.set()
            deadline=time.monotonic()+2
            while session['id'] in sessions.ACTIVE and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(sessions.current(self.workspace,'profile'),cancelled)
        self.assertEqual(candidate.load(self.workspace),original)
        self.assertNotIn(session['id'],sessions.ACTIVE)

    def test_confirmed_phases_keep_revision_cancellable_and_saved_profile_usable(self):
        ai_started,ai_release,validation_started,validation_release=[threading.Event() for _ in range(4)]
        def ai(prompt,cancel=None):
            ai_started.set();ai_release.wait(2);return self.completed_profile(prompt)
        real_plan=owner.profile_plan
        def validate(*args):
            validation_started.set();validation_release.wait(2);return real_plan(*args)
        session=self.call('import_cv',sessions.start(self.workspace,'profile'))
        before=candidate.load(self.workspace)
        with patch.object(sessions.ai,'guided_profile',side_effect=ai),patch.object(owner,'profile_plan',side_effect=validate):
            processing=self.call('choose_source',session,source_id=session['existing_sources'][0]['id'])
            self.assertTrue(ai_started.wait(1))
            self.assertEqual(sessions.current(self.workspace,'profile')['phase'],'preparing')
            ai_release.set();self.assertTrue(validation_started.wait(1))
            checking=sessions.current(self.workspace,'profile')
            self.assertEqual(checking['phase'],'validating')
            self.assertEqual(checking['revision'],processing['revision'])
            self.assertEqual(candidate.load(self.workspace),before)
            self.call('cancel',processing)
            validation_release.set()
            deadline=time.monotonic()+2
            while session['id'] in sessions.ACTIVE and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(sessions.current(self.workspace,'profile')['state'],'cancelled')
        self.assertEqual(candidate.load(self.workspace),before)

    def test_timeout_retains_inputs_and_only_explicit_retry_starts_another_turn(self):
        session=self.call('import_cv',sessions.start(self.workspace,'profile'))
        before=candidate.load(self.workspace)
        with patch.object(sessions.ai,'guided_profile',side_effect=ValueError('Codex timed out.')) as ai:
            self.call('choose_source',session,source_id=session['existing_sources'][0]['id'])
            failed=self.wait()
            self.assertEqual(failed['state'],'failed')
            self.assertTrue(failed['can_retry'])
            self.assertIn('took too long',failed['message'])
            self.assertIn('timed out',failed['failure_detail'])
            for _ in range(3):sessions.current(self.workspace,'profile')
            self.assertEqual(ai.call_count,1)
        stored=sessions.read(self.workspace,'profile')
        self.assertTrue(stored['sources'])
        with patch.object(sessions.ai,'guided_profile',side_effect=self.completed_profile):
            self.call('retry',failed)
            review=self.wait()
        self.assertEqual(review['state'],'review')
        self.assertEqual(candidate.load(self.workspace),before)


    def test_failed_upload_can_be_replaced_by_an_existing_cv(self):
        session=self.call('import_cv',sessions.start(self.workspace,'profile'))
        self.call('choose_source',session,upload=dict(name='Empty.md',data=base64.b64encode(b' ').decode()))
        failed=self.wait()
        self.assertEqual(failed['state'],'failed')
        self.assertIn('pending_upload',sessions.read(self.workspace,'profile'))
        with patch.object(sessions.ai,'guided_profile',side_effect=self.completed_profile):
            self.call('choose_source',failed,source_id=session['existing_sources'][0]['id'])
            self.assertEqual(self.wait()['state'],'review')
        self.assertNotIn('pending_upload',sessions.read(self.workspace,'profile'))



if __name__ == '__main__':
    unittest.main()

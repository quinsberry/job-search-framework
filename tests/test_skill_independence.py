"""Each documented specialist works in a fresh interpreter without the app."""
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest


SKILLS = Path(__file__).resolve().parents[1] / '.agents/skills'
DEPENDENCIES = {'jsf-profile': ['jsf-search'], 'jsf-vacancies': ['jsf-search'],
                'jsf-application': [], 'jsf-search': [], 'jsf-salary': [],
                'jsf-workflow': ['jsf-search', 'jsf-profile', 'jsf-vacancies', 'jsf-application']}


class IndependenceTests(unittest.TestCase):
    def run_python(self, skill, code, dependencies=None):
        env = os.environ.copy()
        env.pop('PYTHONPATH', None)
        with tempfile.TemporaryDirectory() as cwd:
            isolated = Path(cwd) / 'skills'
            for name in [skill] + (DEPENDENCIES[skill] if dependencies is None else dependencies):
                shutil.copytree(SKILLS / name, isolated / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            scripts = isolated / skill / 'scripts'
            run = subprocess.run([sys.executable, '-c',
                                  f'import sys, profile; skill_scripts={str(scripts)!r}; sys.path.insert(0, skill_scripts);\n' + code],
                                 cwd=cwd, env=env, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_profile_preferences_need_no_workflow_initialization(self):
        self.run_python('jsf-profile', '''
import profile, types
for name in ['evaluate', 'search', 'modules']:
    sys.modules[name] = types.ModuleType(name)
from jsf_profile import guided_setup
answers = {'titles':['software engineer'], 'seniorities':None,
           'work_arrangements':['remote'], 'target_count':10}
assert guided_setup.accept_config_answers(None, {}, 0, answers) == answers
assert 'jsf_workflow' not in sys.modules
''')

    def test_workflow_import_does_not_collide_with_standard_library_profile(self):
        self.run_python('jsf-workflow', '''
import profile
standard_profile = profile
from jsf_workflow import workflow, setup_sessions
assert profile is standard_profile
assert hasattr(profile, 'run')
assert callable(workflow.find_jobs)
assert callable(setup_sessions.start)
''')

    def test_original_cli_entrypoints_work_from_an_unrelated_directory(self):
        for skill, entrypoint in {'jsf-profile':'profile.py', 'jsf-search':'search.py', 'jsf-vacancies':'vacancies.py',
                                  'jsf-application':'applications.py', 'jsf-salary':'convert_fx.py', 'jsf-workflow':'workflow.py'}.items():
            with self.subTest(skill=skill):
                self.run_python(skill, f'''
import subprocess
from pathlib import Path
run = subprocess.run([sys.executable, str(Path(skill_scripts) / {entrypoint!r}), '--help'], capture_output=True, text=True)
assert run.returncode == 0, run.stderr
assert 'usage:' in run.stdout
''')

    def test_profile_intake_and_search_preferences_without_the_app(self):
        self.run_python('jsf-profile', '''
from pathlib import Path
from jsf_profile import profile, guided_setup, search_config
cv=Path('CV.md');cv.write_text('Ada Example')
source=profile.extract(cv)['source']
changes={'schema_version':1,'sources':[source],'records':[{'id':'identity','section':'identity','facts':{
    'full_name':{'value':'Ada Example','evidence':[{'source_id':source['id'],'page':1,'quote':'Ada Example'}]}}}]}
profile.apply_plan(Path('jobs'),profile.plan(None,changes))
assert profile.export(Path('jobs'))['outcome']=='ready'
answers={'titles':['software engineer'],'target_count':10,'seniorities':None,'work_arrangements':['remote'],
         'compensation':None,'technical.required':[],'candidate.country':'Poland'}
proposal=guided_setup.config_plan(None,answers)
guided_setup.save_config(Path('jobs'),proposal)
assert search_config.export(Path('jobs'))['titles']==['software engineer']
assert 'jsf_workflow' not in sys.modules
''')

    def test_search_and_history_work_without_profile_or_application_skills(self):
        self.run_python('jsf-vacancies', '''
from jsf_vacancies import vacancies
from jsf_search.evaluate import evaluate
from test_search import config, snapshot, vacancy
result=evaluate(config(),snapshot(vacancy()))
imported=vacancies.import_results(vacancies.empty_history(),result)
vacancies.save('jobs',imported['history'])
before=vacancies.query('jobs')['vacancies'][0]
assert before['fit']=='match'
vacancies.edit('jobs',before['vacancy_id'],'company','My correction','2026-10-16T10:00:00+00:00')
after=vacancies.query('jobs')['vacancies'][0]
assert after['values']['company']=='My correction'
assert before['revision']!=after['revision']
assert 'jsf_profile' not in sys.modules and 'jsf_workflow' not in sys.modules
''')

    def test_application_csv_needs_no_other_skill(self):
        self.run_python('jsf-application', '''
from pathlib import Path
from jsf_application.applications import COLUMNS, validate_record, write_table, read_table
row=dict.fromkeys(COLUMNS,'')
row.update(application_id='one',company='Example',position='Engineer',work_type='remote',status='ready',vacancy_link='https://example.com/jobs/1')
validate_record(row)
path=Path('jobs/applications_table.csv')
write_table(path,COLUMNS,[row])
assert read_table(path)[1]==[row]
assert not any(name.startswith('jsf_search') for name in sys.modules)
''')

    def test_application_tracking_declares_its_identity_dependency(self):
        self.run_python('jsf-application', '''
from jsf_application import tracking
result=tracking.edit('jobs','linkedin:1',{'url:https://www.linkedin.com/jobs/view/1'},
    {'company':'Example','position':'Engineer','work_type':'remote','vacancy_link':'https://www.linkedin.com/jobs/view/1'}, {'applied':True})
assert result['application_id']
assert tracking.submitted(tracking.records('jobs')[0])
assert 'jsf_workflow' not in sys.modules
''', dependencies=['jsf-search'])

    def test_salary_conversion_needs_no_other_skill(self):
        self.run_python('jsf-salary', '''
from decimal import Decimal
from jsf_salary.convert_fx import convert
assert convert(Decimal('100'),'EUR','PLN',{'EUR':Decimal('1'),'PLN':Decimal('4')})==Decimal('400')
assert not any(name.startswith('jsf_search') for name in sys.modules)
''')

    def test_missing_declared_dependency_has_an_actionable_error(self):
        self.run_python('jsf-profile', '''
from jsf_profile import guided_setup
try:
    guided_setup.accept_config_answers(None,{},0,{'titles':['engineer'],'seniorities':None,'work_arrangements':None,'target_count':5})
except ImportError as exc:
    assert 'requires sibling jsf-search' in str(exc)
else:
    raise AssertionError('Missing declared dependency was not detected')
''', dependencies=[])


if __name__ == '__main__':
    unittest.main()

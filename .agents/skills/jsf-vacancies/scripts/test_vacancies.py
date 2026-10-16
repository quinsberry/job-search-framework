from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from jsf_vacancies.vacancies import empty_history, import_results, review, view, ValidationError
from jsf_search.evaluate import evaluate
from test_search import config, vacancy, snapshot


def result(*records, day=10, c=None):
    s = snapshot(*records)
    s['observed_at'] = f'2026-10-{day:02d}T12:00:00+00:00'
    return evaluate(c or config(), s)


def imported(*records, day=10, c=None, history=None):
    return import_results(history if history is not None else empty_history(), result(*records, day=day, c=c))


class HistoryTests(unittest.TestCase):
    def test_pure_replay_and_repeated_later_observation(self):
        h, r = empty_history(), result(vacancy())
        before = deepcopy((h, r))
        first = import_results(h, r)
        self.assertEqual((h, r), before)
        second = import_results(first['history'], r)
        self.assertTrue(second['replayed'])
        self.assertEqual(first['history'], second['history'])
        self.assertTrue(all(not x for x in second['report'].values()))
        later = imported(vacancy(), day=11, history=first['history'])
        record = later['history']['vacancies']['linkedin:1']
        self.assertEqual(len(record['observations']), 1)
        self.assertEqual(len(record['assessments']), 1)
        self.assertEqual(len(later['report']['unchanged']), 1)
        self.assertIn('2026-10-11', view(record)['last_seen'])

    def test_uncapped_rejected_and_clarification_assessments_retained(self):
        c = config()
        c['target_count'] = 1
        rejected, unclear = vacancy('3'), vacancy('4')
        rejected['active'] = False
        unclear['facts'] = {}
        r = imported(vacancy(), vacancy('2'), rejected, unclear, c=c)
        self.assertEqual(len(r['history']['vacancies']), 4)
        statuses = [view(x)['latest_assessment']['assessment']['status'] for x in r['history']['vacancies'].values()]
        self.assertCountEqual(statuses, ['match', 'match', 'rejected', 'needs_clarification'])
        self.assertFalse(r['report']['unassessed'])
        legacy = result(vacancy(), vacancy('2'), c=c)
        legacy.pop('assessments')
        old = import_results(empty_history(), legacy)
        self.assertEqual(old['report']['unassessed'], ['linkedin:2'])

    def test_changes_and_assessment_changes_are_separate(self):
        first = imported(vacancy())
        c = config()
        c['compensation'][0]['minimum'] = 29000
        reassessed = imported(vacancy(), day=11, c=c, history=first['history'])
        self.assertFalse(reassessed['report']['changed'])
        self.assertEqual(len(reassessed['report']['assessment_changed']), 1)
        changed = vacancy()
        changed['description'] += ' Additional compensation negotiable.'
        newer = imported(changed, day=12, c=c, history=reassessed['history'])
        self.assertEqual(newer['report']['changed'][0]['fields'], ['description'])
        self.assertFalse(newer['report']['assessment_changed'])

    def test_missing_failed_and_404_preserve_known_facts(self):
        first = imported(vacancy())
        for status in ('error', 'not_found'):
            v = vacancy()
            v.update(fetch_status=status, active=False, description=None, facts={})
            r = imported(v, day=11, history=first['history'])
            current = view(r['history']['vacancies']['linkedin:1'])
            self.assertEqual(current['known']['description']['value'], vacancy()['description'])
            self.assertFalse(r['report']['closed'])
            self.assertEqual(r['report']['uncertain'], ['linkedin:1'])

    def test_explicit_closure_and_no_guessed_reopening(self):
        closed = vacancy()
        closed['active'] = False
        h = imported(closed)
        self.assertEqual(h['report']['closed'], ['linkedin:1'])
        newer = imported(vacancy(), day=11, history=h['history'])
        self.assertEqual(view(newer['history']['vacancies']['linkedin:1'])['availability'], 'uncertain')
        opened = vacancy()
        opened['active'] = True
        self.assertEqual(view(imported(opened, day=12, history=newer['history'])['history']['vacancies']['linkedin:1'])['availability'], 'open')

    def test_older_import_enriches_without_rewinding_latest(self):
        newer = vacancy()
        newer['description'] += ' New requirements.'
        h = imported(newer, day=12)['history']
        r = imported(vacancy(), day=10, history=h)
        current = view(r['history']['vacancies']['linkedin:1'])
        self.assertEqual(current['known']['description']['value'], newer['description'])
        self.assertIn('2026-10-10', current['first_seen'])
        self.assertFalse(r['report']['changed'])

    def test_absence_compared_only_in_same_scope_and_never_closes(self):
        h = imported(vacancy(), vacancy('2'))['history']
        c = config()
        c['titles'] = ['different title']
        other = imported(vacancy(), day=11, c=c, history=h)
        self.assertFalse(other['report']['not_observed'])
        r = result(vacancy(), day=12)
        r['coverage']['errors'] = ['source blocked']
        current = import_results(other['history'], r)
        self.assertEqual(current['report']['not_observed'], ['linkedin:2'])
        self.assertFalse(current['report']['closed'])
        self.assertEqual(current['history']['scopes'][current['scope_id']]['coverage']['errors'], ['source blocked'])
        # Limits and preferences do not change eligibility scope.
        c = config()
        c.update(target_count=1, discovery_budget=50, preferences=[])
        again = imported(vacancy(), day=13, c=c, history=current['history'])
        self.assertEqual(again['scope_id'], current['scope_id'])

    def test_same_time_checkpoints_accumulate_and_old_scope_not_rewound(self):
        h = imported(vacancy())['history']
        r = imported(vacancy('2'), history=h)
        self.assertFalse(r['report']['not_observed'])
        later = imported(vacancy(), day=12, history=r['history'])
        old = imported(vacancy('3'), day=11, history=later['history'])
        scope = old['history']['scopes'][old['scope_id']]
        self.assertEqual(scope['seen'], ['linkedin:1'])
        self.assertIn('linkedin:3', scope['known'])

    def test_identity_is_proof_based_and_same_time_conflicts_remain_visible(self):
        a, b = vacancy(), vacancy('2')
        self.assertEqual(len(imported(a, b)['history']['vacancies']), 2)
        c = config()
        c['sources'].append('other')
        b.update(source='other', source_id='X', url='https://example.com/jobs/X', title='Different title')
        a['application_url'] = b['application_url'] = 'https://ats.example/apply?jobId=123'
        r = imported(a, b, c=c)
        self.assertEqual(len(r['history']['vacancies']), 1)
        current = view(next(iter(r['history']['vacancies'].values())))
        self.assertIn('title', current['field_conflicts'])
        self.assertNotIn('title', current['known'])
        self.assertEqual(len(r['report']['uncertain']), 1)

    def test_late_identity_bridge_preserves_review_conflicts_and_redirects(self):
        h = imported(vacancy(), vacancy('2'))['history']
        h = review(h, 'linkedin:1', 'shortlisted', '2026-10-10T13:00:00Z')
        h = review(h, 'linkedin:2', 'dismissed', '2026-10-10T14:00:00Z')
        a, b = vacancy(), vacancy('2')
        a['application_url'] = b['application_url'] = 'https://ats.example/apply?jobId=1'
        r = imported(a, b, day=11, history=h)
        self.assertEqual(len(r['history']['vacancies']), 1)
        self.assertEqual(r['history']['redirects']['linkedin:2'], 'linkedin:1')
        current = view(r['history']['vacancies']['linkedin:1'])
        self.assertEqual(current['review']['state'], 'shortlisted')
        self.assertEqual(current['review_conflicts'][0]['state'], 'dismissed')
        self.assertEqual(len(r['history']['vacancies']['linkedin:1']['observations']), 4)
        resolved = review(r['history'], 'linkedin:2', 'dismissed', '2026-10-11T13:00:00Z')
        self.assertFalse(resolved['vacancies']['linkedin:1']['review_conflicts'])

    def test_review_persists_changes_and_rejects_stale_unknown_choices(self):
        h = imported(vacancy())['history']
        h = review(h, vacancy()['url'], 'dismissed', '2026-10-10T13:00:00Z', 'Not interested')
        self.assertEqual(h, review(h, 'linkedin:1', 'dismissed', '2026-10-10T13:00:00Z', 'Not interested'))
        changed = vacancy()
        changed['description'] += ' Changed.'
        r = imported(changed, day=11, history=h)
        self.assertEqual(r['report']['changed'][0]['review_state'], 'dismissed')
        before = deepcopy(h)
        for identifier, at in [('linkedin:1', '2026-10-10T12:00:00Z'), ('unknown', '2026-10-11T13:00:00Z')]:
            with self.assertRaises(ValidationError):
                review(h, identifier, 'shortlisted', at)
        self.assertEqual(h, before)

    def test_merge_same_review_state_retains_newer_decision(self):
        h = imported(vacancy(), vacancy('2'))['history']
        h = review(h, 'linkedin:1', 'shortlisted', '2026-10-10T13:00:00Z', 'First')
        h = review(h, 'linkedin:2', 'shortlisted', '2026-10-10T15:00:00Z', 'Later')
        a, b = vacancy(), vacancy('2')
        a['application_url'] = b['application_url'] = 'https://ats.example/apply?jobId=1'
        r = imported(a, b, day=11, history=h)
        self.assertEqual(r['history']['vacancies']['linkedin:1']['review']['note'], 'Later')
        with self.assertRaises(ValidationError):
            review(r['history'], 'linkedin:1', 'dismissed', '2026-10-10T14:00:00Z')

    def test_foreign_assessment_rejected_before_mutation(self):
        r = result(vacancy())
        r['assessments'][0]['aliases'] = ['linkedin:999']
        h = empty_history()
        with self.assertRaises(ValidationError):
            import_results(h, r)
        self.assertEqual(h, empty_history())


class CLITests(unittest.TestCase):
    def call(self, *args):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('vacancies.py')), *args], capture_output=True, text=True)

    def test_dry_run_import_replay_list_review_and_invalid_history(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, workspace = root / 'results.json', root / 'workspace'
            source.write_text(json.dumps(result(vacancy())))
            original = source.read_bytes()
            args = ['import', '--results', str(source), '--workspace', str(workspace)]
            preview = self.call(*args, '--dry-run')
            self.assertEqual(preview.returncode, 0, preview.stderr)
            self.assertFalse(workspace.exists())
            imported = self.call(*args)
            self.assertEqual(imported.returncode, 0, imported.stderr)
            saved = workspace / 'vacancies/history.json'
            before = saved.read_bytes(), saved.stat().st_mtime_ns
            replay = self.call(*args)
            self.assertTrue(json.loads(replay.stdout)['replayed'])
            self.assertEqual(before, (saved.read_bytes(), saved.stat().st_mtime_ns))
            decision = self.call('review', '--workspace', str(workspace), '--vacancy-id', 'linkedin:1', '--state', 'shortlisted', '--at', '2026-10-12T12:00:00Z')
            self.assertEqual(decision.returncode, 0, decision.stderr)
            listed = self.call('list', '--workspace', str(workspace), '--state', 'shortlisted')
            self.assertEqual(len(json.loads(listed.stdout)['vacancies']), 1)
            self.assertEqual(source.read_bytes(), original)
            saved.write_text('broken history')
            invalid = self.call(*args)
            self.assertEqual(invalid.returncode, 2)
            self.assertEqual(saved.read_text(), 'broken history')


if __name__ == '__main__':
    unittest.main()

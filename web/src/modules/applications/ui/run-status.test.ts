import { expect, test } from 'bun:test';
import type { DoneEvent } from '../model/contracts';
import { runStatusLine, type RunState } from './run-status';

test('run status line for every state and stop reason', () => {
	const base: RunState = {
		status: 'running',
		progress: { processed: 12, matched: 3, skipped: 40 },
		budgets: null,
		failures: { jobs: 0, sources: 0 },
		lastDone: null,
		error: null,
	};
	const done = (reason: DoneEvent['reason'], extra: Partial<DoneEvent> = {}): RunState => ({
		...base,
		status: 'done',
		lastDone: { type: 'done', reason, totals: base.progress, costUsd: 0.001738, unpricedCalls: 0, ...extra },
	});
	expect(runStatusLine({ ...base, status: 'idle' })).toBeNull();
	expect(runStatusLine(base)?.text).toBe('Starting…');
	expect(runStatusLine({ ...base, budgets: { process: 50, match: 10 } })?.text).toBe(
		'Inspected 12 / 50 · Found 3 / 10 · Skipped 40',
	);
	expect(runStatusLine(done('match-budget'))?.text).toBe(
		'Found 3 applications (limit reached) · 12 inspected · 40 skipped · $0.001738',
	);
	expect(runStatusLine(done('process-budget'))?.text).toStartWith('Inspected 12 vacancies (limit reached)');
	expect(runStatusLine(done('no-new'))?.text).toStartWith('No new vacancies near the top of the results');
	expect(runStatusLine(done('exhausted'))?.text).toStartWith('Searched all results');
	expect(runStatusLine(done('cancelled'))?.text).toStartWith('Search cancelled');
	expect(runStatusLine({ ...done('exhausted', { unpricedCalls: 2 }), failures: { jobs: 1, sources: 2 } })?.text).toBe(
		'Searched all results · 12 inspected · 40 skipped · $0.001738 + 2 unpriced · 1 job failed · 2 sources failed',
	);
	expect(runStatusLine({ ...base, status: 'cancelled' })?.text).toBe('Search cancelled · 12 inspected · 40 skipped');
	expect(runStatusLine({ ...base, status: 'failed', error: 'Decision model unavailable' })).toEqual({
		text: 'Decision model unavailable',
		tone: 'error',
	});
});

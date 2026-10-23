import type { DoneEvent, RunProgress } from '../model/contracts';

// What the status line under the Search button says; pure so every stop reason can be tested.
const plural = (count: number, noun: string, nouns = noun + 's') => `${count} ${count === 1 ? noun : nouns}`;

export type RunState = {
	status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed';
	progress: RunProgress;
	budgets: { process: number; match: number } | null;
	failures: { jobs: number; sources: number };
	lastDone: DoneEvent | null;
	error: string | null;
};
const headlines: Record<DoneEvent['reason'], (totals: RunProgress) => string> = {
	'match-budget': (totals) => `Found ${plural(totals.matched, 'application')} (limit reached)`,
	'process-budget': (totals) => `Inspected ${plural(totals.processed, 'vacancy', 'vacancies')} (limit reached)`,
	'no-new': () => 'No new vacancies near the top of the results — try again later or broaden the position titles',
	exhausted: () => 'Searched all results',
	cancelled: () => 'Search cancelled',
	failed: () => 'Search failed',
};
const cost = (usd: number) => `$${Number(usd.toPrecision(4))}`;

export function runStatusLine(run: RunState): { text: string; tone: 'muted' | 'error' } | null {
	const { status, progress, budgets, failures, lastDone } = run;
	if (status === 'idle') return null;
	if (status === 'running') {
		if (!budgets) return { text: 'Starting…', tone: 'muted' };
		return {
			text: `Inspected ${progress.processed} / ${budgets.process} · Found ${progress.matched} / ${budgets.match} · Skipped ${progress.skipped}`,
			tone: 'muted',
		};
	}
	if (status === 'failed') return { text: run.error ?? 'Search failed', tone: 'error' };
	const parts = [
		status === 'cancelled' || !lastDone ? 'Search cancelled' : headlines[lastDone.reason](progress),
		`${progress.processed} inspected`,
		`${progress.skipped} skipped`,
	];
	if (lastDone)
		parts.push(cost(lastDone.costUsd) + (lastDone.unpricedCalls ? ` + ${lastDone.unpricedCalls} unpriced` : ''));
	if (failures.jobs) parts.push(`${plural(failures.jobs, 'job')} failed`);
	if (failures.sources) parts.push(`${plural(failures.sources, 'source')} failed`);
	return { text: parts.join(' · '), tone: 'muted' };
}

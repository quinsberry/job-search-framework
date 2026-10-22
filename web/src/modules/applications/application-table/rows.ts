import type { Application, DoneEvent, LoadResult, RunProgress } from '../model/contracts';

export type Criterion = Application['match']['criteria'][number];
type Job = Application['job'];

// Display rules live here so the components only render; columns never read MatchResult internals.
export type ApplicationRow = {
	id: string;
	title: string;
	url: string;
	company: string | null;
	location: string | null;
	arrangement: string | null;
	salary: string | null;
	outcome: Application['match']['outcome'];
	openQuestions: string[];
	salaryNotAdvertised: boolean;
	source: string;
	publishedAt: string | null;
	matchedAt: string;
	criteria: Criterion[];
};

export const criterionLabel: Record<Criterion['criterion'], string> = {
	availability: 'availability',
	salary: 'salary',
	workArrangement: 'work arrangement',
	location: 'location',
	role: 'role',
	seniority: 'seniority',
	positionType: 'position type',
	skills: 'skills',
};

const more = (count: number) => (count > 1 ? ` +${count - 1}` : '');
const plural = (count: number, noun: string, nouns = noun + 's') => `${count} ${count === 1 ? noun : nouns}`;

export function arrangementOf(application: Application): string | null {
	const advertised = application.job.advertisedFacts?.workArrangements;
	if (advertised?.length) return advertised.join(' / ');
	const detail = application.match.criteria.find((item) => item.criterion === 'workArrangement')?.detail;
	// shortcut: reads the "most likely: X" suffix Search's matcher writes; give MatchResult a structured field if that wording changes.
	const likely = detail?.match(/most likely: ([a-z-]+)/)?.[1];
	return likely && likely !== 'unknown' ? likely : null;
}

const periods = { annual: ' / year', month: ' / month', hourly: ' / hour', unknown: '' };
const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function salaryOf(job: Job): string | null {
	const all = job.advertisedFacts?.compensation ?? [];
	const first = all[0];
	if (!first) return null;
	const { min, max } = first;
	const range =
		min !== null && max !== null
			? min === max
				? money.format(min)
				: `${money.format(min)}–${money.format(max)}`
			: min !== null
				? `from ${money.format(min)}`
				: max !== null
					? `up to ${money.format(max)}`
					: null;
	return (range === null ? first.rawText : `${range} ${first.currency}${periods[first.period]}`) + more(all.length);
}

export function toRow(application: Application, sources: LoadResult['sources']): ApplicationRow {
	const { job, match } = application;
	const salary = salaryOf(job);
	const unknown = match.criteria.filter((item) => item.result === 'unknown');
	// An unadvertised salary is expected on most sources, so it is not counted as an open question.
	const salaryNotAdvertised = !salary && unknown.some((item) => item.criterion === 'salary');
	return {
		id: application.fingerprint,
		title: job.title,
		url: job.url,
		company: job.company?.name ?? null,
		location: job.locations[0] ? job.locations[0].label + more(job.locations.length) : null,
		arrangement: arrangementOf(application),
		salary,
		outcome: match.outcome,
		openQuestions: unknown
			.filter((item) => !(salaryNotAdvertised && item.criterion === 'salary'))
			.map((item) => criterionLabel[item.criterion]),
		salaryNotAdvertised,
		source: sources.find((source) => source.id === job.sourceId)?.name ?? job.sourceId,
		publishedAt: job.publishedAt,
		matchedAt: application.matchedAt,
		criteria: match.criteria,
	};
}

// Default order: matches first, then the fewest open questions, then the newest.
export function toRows({ applications, sources }: LoadResult): ApplicationRow[] {
	return applications
		.map((application) => toRow(application, sources))
		.sort(
			(a, b) =>
				Number(b.outcome === 'match') - Number(a.outcome === 'match') ||
				a.openQuestions.length - b.openQuestions.length ||
				b.matchedAt.localeCompare(a.matchedAt),
		);
}

export function filterRows(rows: ApplicationRow[], text: string) {
	const needle = text.trim().toLowerCase();
	return needle ? rows.filter((row) => `${row.title}\n${row.company ?? ''}`.toLowerCase().includes(needle)) : rows;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const DAY = 24 * 60 * 60 * 1000;
export function relativeDate(iso: string, now = new Date()) {
	const days = Math.round((Date.parse(iso) - now.getTime()) / DAY);
	return Math.abs(days) < 60 ? relative.format(days, 'day') : relative.format(Math.round(days / 30), 'month');
}

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

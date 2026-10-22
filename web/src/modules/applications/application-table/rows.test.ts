import { expect, test } from 'bun:test';
import type { Application, DoneEvent } from '../model/contracts';
import {
	filterRows,
	relativeDate,
	runStatusLine,
	salaryOf,
	toRow,
	toRows,
	type Criterion,
	type RunState,
} from './rows';

const criterion = (name: Criterion['criterion'], result: Criterion['result'], detail = 'detail'): Criterion => ({
	criterion: name,
	result,
	evidence: 'model',
	detail,
});
function application(
	id: string,
	{
		outcome = 'needs-clarification',
		criteria = [],
		matchedAt = '2026-10-22T00:00:00Z',
		job = {},
	}: {
		outcome?: Application['match']['outcome'];
		criteria?: Criterion[];
		matchedAt?: string;
		job?: Partial<Application['job']>;
	} = {},
): Application {
	return {
		fingerprint: id.padStart(64, '0'),
		job: {
			sourceId: 'linkedin',
			sourceJobId: id,
			url: `https://www.linkedin.com/jobs/view/${id}`,
			title: `Engineer ${id}`,
			company: { name: 'Acme', url: null },
			locations: [],
			publishedAt: null,
			observedAt: '2026-10-20T00:00:00Z',
			availability: 'open',
			...job,
		},
		match: { outcome, criteria, costUsd: null },
		matchedAt,
	};
}
const sources = [{ id: 'linkedin' as const, name: 'LinkedIn', supportedFilters: [] }];
const facts = (compensation: NonNullable<Application['job']['advertisedFacts']>['compensation']) => ({
	advertisedFacts: {
		workArrangements: null,
		workArrangementsText: null,
		seniorityText: null,
		employmentText: null,
		skills: null,
		expiresAt: null,
		compensation,
	},
});
const pay = (min: number | null, max: number | null) => ({
	min,
	max,
	currency: 'PLN',
	period: 'month' as const,
	contractType: 'B2B' as const,
	rawText: 'per agreement',
});

test('arrangement prefers advertised facts, then the model guess, else unknown', () => {
	const guess = criterion('workArrangement', 'unknown', 'Probability…; most likely: hybrid');
	expect(toRow(application('1', { criteria: [guess] }), sources).arrangement).toBe('hybrid');
	const advertised = facts(null);
	advertised.advertisedFacts.workArrangements = ['remote', 'hybrid'] as never;
	expect(toRow(application('1', { criteria: [guess], job: advertised }), sources).arrangement).toBe(
		'remote / hybrid',
	);
	const unknown = criterion('workArrangement', 'unknown', 'Probability…; most likely: unknown');
	expect(toRow(application('1', { criteria: [unknown] }), sources).arrangement).toBeNull();
	expect(toRow(application('1'), sources).arrangement).toBeNull();
});

test('salary text covers ranges, single bounds, several offers and none', () => {
	const salary = (...offers: ReturnType<typeof pay>[]) => salaryOf(application('1', { job: facts(offers) }).job);
	expect(salary(pay(10000, 15000))).toBe('10,000–15,000 PLN / month');
	expect(salary(pay(10000, null))).toBe('from 10,000 PLN / month');
	expect(salary(pay(null, 15000))).toBe('up to 15,000 PLN / month');
	expect(salary(pay(null, null))).toBe('per agreement');
	expect(salary(pay(10000, 10000), pay(1, 2))).toBe('10,000 PLN / month +1');
	expect(salaryOf(application('1').job)).toBeNull();
});

test('an unadvertised salary is muted rather than counted as an open question', () => {
	const criteria = [criterion('salary', 'unknown'), criterion('seniority', 'unknown'), criterion('role', 'met')];
	const row = toRow(application('1', { criteria }), sources);
	expect(row).toMatchObject({ openQuestions: ['seniority'], salaryNotAdvertised: true, salary: null });
	const advertised = toRow(application('1', { criteria, job: facts([pay(1, 2)]) }), sources);
	expect(advertised).toMatchObject({ openQuestions: ['salary', 'seniority'], salaryNotAdvertised: false });
});

test('default order puts matches first, then fewer open questions, then newest', () => {
	const rows = toRows({
		sources,
		applications: [
			application('a', { criteria: [criterion('seniority', 'unknown')] }),
			application('b', { matchedAt: '2026-10-23T00:00:00Z' }),
			application('c', { outcome: 'match', matchedAt: '2026-10-01T00:00:00Z' }),
			application('d', { criteria: [criterion('salary', 'unknown')] }),
		],
	});
	expect(rows.map((row) => row.title)).toEqual(['Engineer c', 'Engineer b', 'Engineer d', 'Engineer a']);
});

test('source names come from the load result, falling back to the id', () => {
	expect(toRow(application('1'), sources).source).toBe('LinkedIn');
	expect(toRow(application('1'), []).source).toBe('linkedin');
});

test('filter matches title or company, case-insensitively', () => {
	const rows = toRows({
		sources,
		applications: [application('1'), application('2', { job: { company: { name: 'Sii Poland', url: null } } })],
	});
	expect(filterRows(rows, 'sii').map((row) => row.title)).toEqual(['Engineer 2']);
	expect(filterRows(rows, 'ENGINEER 1')).toHaveLength(1);
	expect(filterRows(rows, '  ')).toHaveLength(2);
});

test('relative dates', () => {
	const now = new Date('2026-10-23T12:00:00Z');
	expect(relativeDate('2026-10-23T08:00:00Z', now)).toBe('today');
	expect(relativeDate('2026-10-20', now)).toBe('3 days ago');
	expect(relativeDate('2026-06-01', now)).toBe('5 months ago');
});

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

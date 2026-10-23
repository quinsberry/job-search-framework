import { expect, test } from 'bun:test';
import type { SearchApplication } from '../../model/contracts';
import { assessApplication } from '../../model/manual-assessment';
import { filterRows, relativeDate, salaryOf, toRow, toRows } from './rows';

type Criterion = SearchApplication['match']['criteria'][number];

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
		criteria = [criterion('salary', 'unknown')],
		addedAt = '2026-10-22T00:00:00Z',
		job = {},
	}: {
		outcome?: SearchApplication['match']['outcome'];
		criteria?: Criterion[];
		addedAt?: string;
		job?: Partial<SearchApplication['job']>;
	} = {},
) {
	const row: SearchApplication = {
		origin: 'search',
		status: 'new',
		expectedSalary: null,
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
		addedAt,
	};
	return { ...row, assessment: assessApplication(row, []) };
}
const sources = [{ id: 'linkedin' as const, name: 'LinkedIn', supportedFilters: [] }];
const facts = (compensation: NonNullable<SearchApplication['job']['advertisedFacts']>['compensation']) => ({
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
			application('b', { addedAt: '2026-10-23T00:00:00Z' }),
			application('c', { outcome: 'match', criteria: [], addedAt: '2026-10-01T00:00:00Z' }),
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

test('manual rows show their typed facts and sort with matches', () => {
	const manual = {
		origin: 'manual' as const,
		fingerprint: 'f'.repeat(64),
		status: 'applied' as const,
		expectedSalary: '25k PLN',
		addedAt: '2026-10-21T00:00:00Z',
		url: 'https://example.com/job',
		title: 'Manual role',
		company: 'Acme',
		location: 'Warsaw',
		salary: '20–24k PLN',
	};
	const row = toRow(manual, sources);
	expect(row).toMatchObject({
		outcome: 'manual',
		source: 'Manual',
		salary: '20–24k PLN',
		status: 'applied',
		expectedSalary: '25k PLN',
		openQuestions: [],
		criteria: [],
	});
	const rows = toRows({ sources, applications: [application('a'), manual] });
	expect(rows.map((item) => item.title)).toEqual(['Manual role', 'Engineer a']);
});

test('the status filter shows active rows by default and never loses the rest', () => {
	const rows = toRows({
		sources,
		applications: (['new', 'applied', 'interviewing', 'offer', 'rejected', 'dismissed'] as const).map((status) => ({
			...application(status),
			status,
		})),
	});
	const titles = (filter: Parameters<typeof filterRows>[2]) => filterRows(rows, '', filter).map((row) => row.status);
	expect(titles('active').sort()).toEqual(['applied', 'interviewing', 'new', 'offer']);
	expect(titles('all')).toHaveLength(6);
	expect(titles('dismissed')).toEqual(['dismissed']);
	expect(filterRows(rows, 'engineer rejected', 'active')).toEqual([]);
});

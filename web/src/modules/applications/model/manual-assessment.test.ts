import { expect, test } from 'bun:test';
import { assessApplication } from './manual-assessment';
import { applicationsFileSchema, changesSchemas, type SearchApplication } from './contracts';
import { toRow } from '../ui/application-table/rows';

const salary = { amount: 25000, currency: 'PLN', period: 'month' as const, contractType: 'B2B' as const };
const band = { min: 25000, desired: 30000, currency: 'PLN', period: 'month', contractType: 'B2B' };
const original: SearchApplication = {
	origin: 'search',
	fingerprint: 'a'.repeat(64),
	status: 'applied',
	expectedSalary: null,
	addedAt: '2026-10-23T12:00:00Z',
	job: {
		sourceId: 'linkedin',
		sourceJobId: '1',
		url: 'https://example.com/job',
		title: 'Engineer',
		company: null,
		locations: [],
		publishedAt: null,
		observedAt: '2026-10-23T12:00:00Z',
		availability: 'open',
	},
	match: {
		outcome: 'needs-clarification',
		costUsd: 0.01,
		criteria: [
			{
				criterion: 'workArrangement',
				result: 'unknown',
				evidence: 'model',
				detail: 'Not enough evidence; most likely: hybrid',
			},
			{ criterion: 'salary', result: 'unknown', evidence: 'structured', detail: 'Employer pay is missing' },
			{ criterion: 'location', result: 'met', evidence: 'model', detail: 'Location confirmed' },
		],
	},
};

test('manual resolutions update all display fields while keeping original evidence and reset reversible', () => {
	const before = structuredClone(original);
	const row = { ...original, workArrangementOverride: ['remote', 'hybrid'] as const, expectedSalary: salary };
	const input = { ...row, workArrangementOverride: [...row.workArrangementOverride] };
	const assessment = assessApplication(input, [band]);
	expect(assessment.match.outcome).toBe('match');
	expect(assessment.match.criteria.map((item) => item.evidence)).toEqual(['manual', 'manual', 'model']);
	const display = toRow({ ...input, assessment }, []);
	expect(display).toMatchObject({
		arrangement: 'remote / hybrid',
		outcome: 'match',
		openQuestions: [],
		salaryNotAdvertised: false,
		salary: null,
		status: 'applied',
		expectedSalaryLabel: '25,000 PLN / month B2B',
	});
	expect(original).toEqual(before);
	expect(input.match).toEqual(before.match);
	expect(assessApplication({ ...input, workArrangementOverride: null, expectedSalary: null }, [band]).match).toEqual(
		before.match,
	);
	const unknownLocation = {
		...input,
		match: {
			...input.match,
			criteria: input.match.criteria.map((item) =>
				item.criterion === 'location' ? { ...item, result: 'unknown' as const } : item,
			),
		},
	};
	const unresolved = assessApplication(unknownLocation, [band]);
	expect(toRow({ ...unknownLocation, assessment: unresolved }, [])).toMatchObject({
		outcome: 'needs-clarification',
		openQuestions: ['location'],
	});
});

test('salary uses any compatible minimum, has no desired ceiling, and restores original results when it stops qualifying', () => {
	const input = { ...original, expectedSalary: salary };
	const criterion = (row: SearchApplication, bands = [band]) =>
		assessApplication(row, bands).match.criteria.find((item) => item.criterion === 'salary');
	for (const amount of [25000, 40000])
		expect(criterion({ ...input, expectedSalary: { ...salary, amount } })).toMatchObject({
			result: 'met',
			evidence: 'manual',
		});
	for (const expectedSalary of [
		null,
		'25k PLN/month B2B',
		{ ...salary, amount: 24999 },
		{ ...salary, currency: 'EUR' },
		{ ...salary, period: 'annual' as const },
		{ ...salary, contractType: 'permanent' as const },
	])
		expect(criterion({ ...input, expectedSalary })).toEqual(original.match.criteria[1]);
	expect(criterion(input, [])).toEqual(original.match.criteria[1]);
	expect(criterion(input, [{ ...band, min: 26000 }, band])).toMatchObject({ evidence: 'manual' });
	expect(criterion(input, [{ ...band, min: 26000 }])).toEqual(original.match.criteria[1]);
	expect(criterion(input)).toMatchObject({ evidence: 'manual' });
	const alreadyMet = {
		...input,
		expectedSalary: null,
		match: {
			...original.match,
			criteria: original.match.criteria.map((item) =>
				item.criterion === 'salary' ? { ...item, result: 'met' as const } : item,
			),
		},
	};
	expect(criterion(alreadyMet)).toEqual(alreadyMet.match.criteria[1]);
	const absent = {
		...input,
		match: { ...input.match, criteria: input.match.criteria.filter((item) => item.criterion !== 'salary') },
	};
	expect(assessApplication(absent, [band]).match.criteria.some((item) => item.criterion === 'salary')).toBe(false);
	const failed = {
		...input,
		match: { ...input.match, criteria: [{ ...input.match.criteria[2]!, result: 'failed' as const }] },
	};
	expect(() => assessApplication(failed, [band])).toThrow('failed criterion');
});

test('storage accepts legacy rows and new inputs but rejects derived assessments and malformed corrections', () => {
	for (const schemaVersion of [2, 3])
		expect(
			applicationsFileSchema.parse({ schemaVersion, applications: [original], deleted: [] }).applications[0],
		).toEqual(original);
	for (const changes of [
		{ workArrangementOverride: [] },
		{ workArrangementOverride: ['remote', 'remote'] },
		{ expectedSalary: { ...salary, amount: 0 } },
		{ expectedSalary: { ...salary, currency: 'pln' } },
		{ expectedSalary: { ...salary, period: 'unknown' } },
		{ assessment: assessApplication(original, []) },
		{ match: original.match },
		{ job: original.job },
	])
		expect(changesSchemas.search.safeParse(changes).success).toBe(false);
	expect(changesSchemas.search.parse({ workArrangementOverride: ['remote'], expectedSalary: salary })).toEqual({
		workArrangementOverride: ['remote'],
		expectedSalary: salary,
	});
	expect(
		applicationsFileSchema.safeParse({
			schemaVersion: 3,
			applications: [{ ...original, assessment: assessApplication(original, []) }],
		}).success,
	).toBe(false);
});

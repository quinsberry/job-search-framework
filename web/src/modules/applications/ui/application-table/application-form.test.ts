import { expect, test } from 'bun:test';
import type { SearchApplication } from '../../model/contracts';
import { applicationFormSchema, formDefaults } from './application-form';
import { assessApplication } from '../../model/manual-assessment';
import { toRow } from './rows';

const sources = [{ id: 'linkedin' as const, name: 'LinkedIn', supportedFilters: [] }];
const application: SearchApplication = {
	origin: 'search',
	fingerprint: '1'.padStart(64, '0'),
	status: 'new',
	expectedSalary: null,
	addedAt: '2026-10-22T00:00:00Z',
	job: {
		sourceId: 'linkedin',
		sourceJobId: '1',
		url: 'https://www.linkedin.com/jobs/view/1',
		title: 'Engineer 1',
		company: { name: 'Acme', url: null },
		locations: [],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		availability: 'open',
	},
	match: { outcome: 'needs-clarification', criteria: [], costUsd: null },
};
const loaded = (row: SearchApplication) => ({ ...row, assessment: assessApplication(row, []) });

test('form defaults edit every field as text', () => {
	expect(formDefaults(null)).toEqual({
		status: 'new',
		expectedSalary: null,
		workArrangementOverride: null,
		url: '',
		title: '',
		company: '',
		location: '',
		salary: '',
	});
	const row = toRow(loaded({ ...application, status: 'offer', expectedSalary: '25k' }), sources);
	expect(formDefaults(row)).toMatchObject({
		status: 'offer',
		expectedSalary: '25k',
		title: 'Engineer 1',
		company: 'Acme',
	});
});

test('structured salary is validated before submission while legacy text is retained explicitly', () => {
	const input = {
		...formDefaults(null),
		expectedSalary: { amount: '25000.50', currency: 'PLN', period: 'month', contractType: 'B2B' },
		workArrangementOverride: ['remote'],
	};
	const parsed = applicationFormSchema('search').parse(input);
	expect(parsed).toEqual({
		status: 'new',
		expectedSalary: { amount: 25000.5, currency: 'PLN', period: 'month' as const, contractType: 'B2B' as const },
		workArrangementOverride: ['remote'],
	});
	for (const amount of ['', '0', '-1', '25k', 'Infinity'])
		expect(
			applicationFormSchema('search').safeParse({ ...input, expectedSalary: { ...input.expectedSalary, amount } })
				.success,
		).toBe(false);
	expect(
		applicationFormSchema('search').safeParse({ ...input, expectedSalary: { ...input.expectedSalary, period: '' } })
			.success,
	).toBe(false);
	expect(applicationFormSchema('search').safeParse({ ...input, workArrangementOverride: [] }).success).toBe(false);
	expect(
		applicationFormSchema('search').parse({ ...input, expectedSalary: null, workArrangementOverride: null }),
	).toMatchObject({ expectedSalary: null, workArrangementOverride: null });
	expect(applicationFormSchema('search').parse({ ...input, expectedSalary: '25k' }).expectedSalary).toBe('25k');
	const row = toRow(
		loaded({
			...application,
			expectedSalary: { amount: 25000, currency: 'PLN', period: 'month', contractType: 'B2B' },
			workArrangementOverride: ['hybrid'],
		}),
		sources,
	);
	expect(formDefaults(row)).toMatchObject({
		expectedSalary: { amount: '25000', currency: 'PLN', period: 'month', contractType: 'B2B' },
		workArrangementOverride: ['hybrid'],
	});
});

test('unfinished salary choices have readable field errors without irrelevant union messages', () => {
	const parsed = applicationFormSchema('search').safeParse({
		...formDefaults(null),
		expectedSalary: { amount: '', currency: '', period: '', contractType: '' },
	});
	expect(parsed.success).toBe(false);
	if (!parsed.success)
		expect(parsed.error.issues.map((issue) => issue.message)).toEqual([
			'Enter an amount',
			'Choose a currency',
			'Choose a pay period',
			'Choose a contract type',
		]);
});

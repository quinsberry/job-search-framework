import { expect, test } from 'bun:test';
import type { JobDetail } from '@/shared/search-sources/contracts';
import { searchPreferencesSchema, type SearchPreferences } from '../../../model/schema';
import { structuredChecks } from '../structured';

export function fixture(): { job: JobDetail; preferences: SearchPreferences; skills: string[] } {
	return {
		job: {
			sourceId: 'linkedin',
			sourceJobId: '123456',
			url: 'https://www.linkedin.com/jobs/view/123456',
			title: 'API Engineer',
			company: null,
			locations: [],
			publishedAt: '2026-10-01',
			observedAt: '2026-10-20T00:00:00Z',
			description: 'Build APIs. Must have Node.js and SQL. Kubernetes is nice to have.',
			availability: 'unknown',
			advertisedFacts: {
				workArrangements: null,
				workArrangementsText: null,
				seniorityText: null,
				employmentText: null,
				skills: null,
				expiresAt: null,
				compensation: null,
			},
		},
		preferences: searchPreferencesSchema.parse({
			targetPosition: {
				positionTitles: ['API Engineer'],
				seniority: ['middle', 'senior'],
				positionType: ['full-time'],
				workArrangements: ['remote'],
				salaryRange: [],
			},
			settings: { maxJobsToProcess: 100, maxJobsToMatch: 10 },
		}),
		skills: ['NodeJS', 'SQL'],
	};
}

test('closed is failed, unknown/open availability and optional criteria are omitted', () => {
	const { job, ...criteria } = fixture();
	expect(structuredChecks(job, criteria)).toEqual([]);
	expect(structuredChecks({ ...job, availability: 'open' }, criteria)).toEqual([]);
	expect(structuredChecks({ ...job, availability: 'closed' }, criteria)).toEqual([
		{ criterion: 'availability', result: 'failed', evidence: 'structured', detail: 'Posting is explicitly closed' },
	]);
});

test('salary compares native units, uses max or min, ignores desired and accepts any suitable band', () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.targetPosition.salaryRange = [
		{ contractType: 'B2B', currency: 'PLN', period: 'month', min: 20000, desired: 30000 },
	];
	const entry = {
		min: 15000,
		max: 20000,
		currency: 'PLN',
		period: 'month' as const,
		contractType: 'B2B' as const,
		rawText: '15000–20000 PLN/month B2B',
	};
	const result = (entries: NonNullable<NonNullable<JobDetail['advertisedFacts']>['compensation']>) =>
		structuredChecks(
			{ ...job, advertisedFacts: { ...job.advertisedFacts!, compensation: entries } },
			criteria,
		).find((item) => item.criterion === 'salary')?.result;
	expect(result([entry])).toBe('met');
	expect(result([{ ...entry, max: 19999 }])).toBe('failed');
	expect(result([{ ...entry, min: 20000, max: null }])).toBe('met');
	expect(result([{ ...entry, min: null }])).toBe('met');
	expect(result([{ ...entry, min: null, max: null }])).toBe('unknown');
	expect(result([])).toBe('unknown');
	for (const extra of [{ contractType: 'permanent' as const }, { currency: 'EUR' }, { period: 'hourly' as const }])
		expect(result([{ ...entry, ...extra }])).toBe('unknown');
	expect(
		result([
			{ ...entry, max: 19999 },
			{ ...entry, min: 25000, max: null },
		]),
	).toBe('met');
});

test('work arrangements intersect and only a confirmed residence match resolves location', () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.targetPosition.workArrangements = ['hybrid', 'on-site'];
	criteria.preferences.targetPosition.location = { city: 'Warsaw', country: 'Poland' };
	job.advertisedFacts!.workArrangements = ['hybrid'];
	job.locations = [{ label: 'Warsaw', city: 'WARSAW', country: 'poland' }];
	expect(structuredChecks(job, criteria).map((item) => [item.criterion, item.result])).toEqual([
		['workArrangement', 'met'],
		['location', 'met'],
	]);
	job.locations[0].city = 'Gdynia';
	expect(structuredChecks(job, criteria).some((item) => item.criterion === 'location')).toBe(false);
	job.advertisedFacts!.workArrangements = ['remote'];
	expect(structuredChecks(job, criteria).map((item) => [item.criterion, item.result])).toEqual([
		['workArrangement', 'failed'],
	]);
});

test('structured skill coverage normalises and deduplicates must-haves at the exact threshold', () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.settings.minSkillMatch = 50;
	criteria.skills = ['nodeJS', 'Kubernetes'];
	job.advertisedFacts!.skills = ['Node.js', 'SQL', 'node.js'];
	expect(structuredChecks(job, criteria).at(-1)?.result).toBe('met');
	criteria.preferences.settings.minSkillMatch = 51;
	expect(structuredChecks(job, criteria).at(-1)?.result).toBe('failed');
	job.advertisedFacts!.skills = [];
	expect(structuredChecks(job, criteria).at(-1)?.result).toBe('met');
});

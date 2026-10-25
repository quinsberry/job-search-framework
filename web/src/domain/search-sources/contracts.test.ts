import { expect, test } from 'bun:test';
import {
	discoveryQuerySchema,
	jobDetailSchema,
	jobRefSchema,
	pageLimitSchema,
	sourceIdSchema,
	type JobDetail,
} from './contracts';

test('portable inputs reject unknown IDs, unsafe URLs, unknown keys and invalid limits', () => {
	expect(sourceIdSchema.safeParse('justjoin').success).toBe(false);
	for (const query of [
		{ query: '' },
		{ query: 'x', workArrangements: [] },
		{ query: 'x', workArrangements: ['onsite'] },
		{ query: 'x', jobage: 1 },
		{ query: 'x', publishedAfter: 'yesterday' },
	])
		expect(discoveryQuerySchema.safeParse(query).success).toBe(false);
	for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) expect(pageLimitSchema.safeParse(limit).success).toBe(false);
	for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com/'])
		expect(jobRefSchema.safeParse({ sourceId: 'linkedin', sourceJobId: 'abc', url }).success).toBe(false);
});

test('native compensation, multiple locations, unknowns and date precision survive validation', () => {
	const job: JobDetail = {
		sourceId: 'linkedin',
		sourceJobId: 'non-numeric-id',
		url: 'https://example.com/jobs/non-numeric-id',
		title: 'Engineer',
		company: null,
		locations: [
			{ label: 'Warsaw', city: 'Warsaw', country: 'Poland' },
			{ label: 'Gdynia', city: null, country: null },
		],
		publishedAt: '2026-10-01',
		observedAt: '2026-10-19T12:00:00Z',
		description: 'Work on APIs',
		availability: 'unknown',
		advertisedFacts: {
			workArrangements: null,
			workArrangementsText: null,
			seniorityText: null,
			employmentText: null,
			skills: null,
			expiresAt: '2026-11-01',
			compensation: [
				{
					min: 100,
					max: 150,
					currency: 'PLN',
					period: 'hourly',
					contractType: 'B2B',
					rawText: '100–150 PLN/h B2B',
				},
				{
					min: 10000,
					max: 15000,
					currency: 'CHF',
					period: 'month',
					contractType: 'permanent',
					rawText: '10000–15000 CHF/month permanent',
				},
			],
		},
	};
	expect(jobDetailSchema.parse(job)).toEqual(job);
	expect(
		jobDetailSchema.safeParse({ ...job, advertisedFacts: { ...job.advertisedFacts!, compensation: null } }).success,
	).toBe(true);
	expect(jobDetailSchema.safeParse({ ...job, vendorData: {} }).success).toBe(false);
	expect(jobDetailSchema.safeParse({ ...job, publishedAt: '2026-02-30' }).success).toBe(false);
});

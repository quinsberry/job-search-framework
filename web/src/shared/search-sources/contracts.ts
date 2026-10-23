import { z } from 'zod';

export const sourceIdSchema = z.enum(['linkedin']);
export type SourceId = z.infer<typeof sourceIdSchema>;
const text = z.string().trim().min(1).max(2000);
export const httpUrlSchema = z
	.url()
	.max(4000)
	.refine((value) => {
		// Refinements still run after the URL check fails, so a non-URL must not reach the constructor.
		if (!URL.canParse(value)) return false;
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
	}, 'Expected an HTTP(S) URL without credentials');
export const sourceDateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const workArrangementSchema = z.enum(['remote', 'hybrid', 'on-site']);
export const discoveryFilterSchema = z.enum(['location', 'workArrangements', 'publishedAfter']);
export const sourceDescriptorSchema = z.strictObject({
	id: sourceIdSchema,
	name: text,
	supportedFilters: z.array(discoveryFilterSchema).max(3),
});
export const discoveryQuerySchema = z.strictObject({
	query: text,
	location: text.optional(),
	workArrangements: z
		.array(workArrangementSchema)
		.min(1)
		.max(3)
		.refine((items) => new Set(items).size === items.length)
		.optional(),
	publishedAfter: z.iso.datetime({ offset: true }).optional(),
});
export const pageLimitSchema = z.number().int().min(1).max(100);
export const adapterSearchInputSchema = z.strictObject({
	query: discoveryQuerySchema,
	limit: pageLimitSchema,
	cursor: z.string().min(1).max(100000).optional(),
});
export const jobRefSchema = z.strictObject({ sourceId: sourceIdSchema, sourceJobId: text, url: httpUrlSchema });
export const jobLocationSchema = z.strictObject({ label: text, city: text.nullable(), country: text.nullable() });
export const jobSummarySchema = jobRefSchema.extend({
	title: text,
	company: z.strictObject({ name: text.nullable(), url: httpUrlSchema.nullable() }).nullable(),
	locations: z.array(jobLocationSchema).max(100),
	publishedAt: sourceDateSchema.nullable(),
	observedAt: z.iso.datetime({ offset: true }),
});
export const compensationSchema = z
	.strictObject({
		min: z.number().finite().nonnegative().nullable(),
		max: z.number().finite().nonnegative().nullable(),
		currency: z.string().regex(/^[A-Z]{3}$/),
		period: z.enum(['annual', 'month', 'hourly', 'unknown']),
		contractType: z.enum(['permanent', 'B2B', 'unknown']),
		rawText: text,
	})
	.refine((value) => value.min === null || value.max === null || value.min <= value.max);
export const advertisedFactsSchema = z.strictObject({
	workArrangements: z.array(workArrangementSchema).max(3).nullable(),
	workArrangementsText: text.nullable(),
	seniorityText: text.nullable(),
	employmentText: text.nullable(),
	skills: z.array(text).max(200).nullable(),
	expiresAt: sourceDateSchema.nullable(),
	compensation: z.array(compensationSchema).max(20).nullable(),
});
export const jobDetailSchema = jobSummarySchema.extend({
	description: z.string().trim().min(1).max(200000).nullable(),
	availability: z.enum(['open', 'closed', 'unknown']),
	advertisedFacts: advertisedFactsSchema.optional(),
});
export const filterReportSchema = z.strictObject({
	filter: discoveryFilterSchema,
	application: z.enum(['applied', 'approximate', 'unsupported']),
	message: text,
});
export const sourcePageSchema = z.strictObject({
	jobs: z.array(jobSummarySchema).max(100),
	nextCursor: z.string().min(1).max(100000).nullable(),
	filters: z.array(filterReportSchema).max(3),
});
export const sourceErrorCodeSchema = z.enum([
	'invalid-input',
	'busy',
	'blocked',
	'rate-limited',
	'timeout',
	'network',
	'not-found',
	'invalid-response',
	'unavailable',
	'cancelled',
]);
export const sourceFailureSchema = z.strictObject({ code: sourceErrorCodeSchema, message: text });
export class SearchSourceError extends Error {
	constructor(
		public readonly code: z.infer<typeof sourceErrorCodeSchema>,
		message: string,
	) {
		super(message);
		this.name = 'SearchSourceError';
	}
}
export function sourceFailure(error: unknown): SourceFailure {
	return error instanceof SearchSourceError
		? { code: error.code, message: error.message.trim().slice(0, 2000) || 'Source acquisition failed' }
		: { code: 'unavailable', message: 'Source acquisition failed' };
}
export function cancellationError(signal: AbortSignal): SearchSourceError {
	return new SearchSourceError(
		signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled',
		'Source run stopped',
	);
}
export const detailResultSchema = z.discriminatedUnion('ok', [
	z.strictObject({ ok: z.literal(true), job: jobDetailSchema }),
	z.strictObject({ ok: z.literal(false), ref: jobRefSchema, error: sourceFailureSchema }),
]);
export const sourceReportSchema = z.strictObject({
	sourceId: sourceIdSchema,
	status: z.enum(['active', 'exhausted', 'failed']),
	filters: z.array(filterReportSchema).max(3),
	error: sourceFailureSchema.nullable(),
});
export const searchBatchSchema = z.strictObject({
	jobs: z.array(jobSummarySchema).max(100),
	done: z.boolean(),
	sources: z.array(sourceReportSchema).max(20),
});
export const sourceRunInputSchema = z.strictObject({
	sourceIds: z
		.array(sourceIdSchema)
		.min(1)
		.max(20)
		.refine((ids) => new Set(ids).size === ids.length),
	query: discoveryQuerySchema,
});
export type SourceDescriptor = z.infer<typeof sourceDescriptorSchema>;
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
export type JobRef = z.infer<typeof jobRefSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
export type SourcePage = z.infer<typeof sourcePageSchema>;
export type SearchBatch = z.infer<typeof searchBatchSchema>;
export type DetailResult = z.infer<typeof detailResultSchema>;
export type SourceFailure = z.infer<typeof sourceFailureSchema>;
export type SourceReport = z.infer<typeof sourceReportSchema>;
export interface SearchSourceAdapter {
	readonly descriptor: SourceDescriptor;
	search(input: z.infer<typeof adapterSearchInputSchema>, signal: AbortSignal): Promise<SourcePage>;
	getDetail(ref: JobRef, signal: AbortSignal): Promise<DetailResult>;
}
export interface SearchSourceRun {
	next(limit: number): Promise<SearchBatch>;
	getDetail(ref: JobRef): Promise<DetailResult>;
	dispose(): void;
}

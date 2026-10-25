import { z } from 'zod';
import { acceptedMatchResultSchema } from '@/domain/matching/contracts';
import {
	httpUrlSchema,
	compensationSchema,
	workArrangementSchema,
	jobDetailSchema,
	jobRefSchema,
	sourceDescriptorSchema,
	sourceFailureSchema,
	sourceIdSchema,
} from '@/domain/search-sources/contracts';

const timestamp = z.iso.datetime({ offset: true });
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

export const applicationStatuses = ['new', 'applied', 'interviewing', 'offer', 'rejected', 'dismissed'] as const;
export const statusSchema = z.enum(applicationStatuses);
export type ApplicationStatus = z.output<typeof statusSchema>;
// Empty text is stored as null, so a cleared field and a never-set one look the same.
const note = z.preprocess(
	(value) => (typeof value === 'string' && !value.trim() ? null : value),
	z.string().trim().max(300).nullable(),
);

export const structuredSalarySchema = z.strictObject({
	amount: z.number({ error: 'Enter a valid amount' }).positive('Amount must be positive'),
	currency: compensationSchema.shape.currency,
	period: compensationSchema.shape.period.exclude(['unknown']),
	contractType: compensationSchema.shape.contractType.exclude(['unknown']),
});
export const expectedSalarySchema = z.union([structuredSalarySchema, note]);
export type ExpectedSalary = z.output<typeof expectedSalarySchema>;
const arrangementOverrideSchema = z
	.array(workArrangementSchema)
	.min(1, 'Select at least one arrangement or reset to original')
	.max(3)
	.refine((items) => new Set(items).size === items.length, 'Duplicate arrangements')
	.nullable();
const effectiveCriterionSchema = acceptedMatchResultSchema.shape.criteria.element.extend({
	evidence: z.enum(['structured', 'model', 'manual']),
});
export const assessmentSchema = z.strictObject({
	match: acceptedMatchResultSchema.extend({ criteria: z.array(effectiveCriterionSchema).max(8) }),
	workArrangements: z.array(workArrangementSchema).nullable(),
});
export type Assessment = z.output<typeof assessmentSchema>;

// Fields the job seeker owns on every row; the workflow never sets them beyond their defaults.
const tracked = {
	fingerprint,
	status: statusSchema,
	expectedSalary: expectedSalarySchema,
	addedAt: timestamp,
};
const searchFound = {
	job: jobDetailSchema.omit({ description: true }),
	match: acceptedMatchResultSchema,
};
const manualFields = {
	url: z.string().trim().min(1, 'Paste the link to the posting').pipe(httpUrlSchema),
	title: z.string().trim().min(1, 'Enter the job title').max(300),
	company: note,
	location: note,
	// The salary as advertised, typed by the job seeker.
	salary: note,
};
export const searchApplicationSchema = z.strictObject({
	origin: z.literal('search'),
	...tracked,
	...searchFound,
	workArrangementOverride: arrangementOverrideSchema.optional(),
});
export const manualApplicationSchema = z.strictObject({ origin: z.literal('manual'), ...tracked, ...manualFields });
export const applicationSchema = z.discriminatedUnion('origin', [searchApplicationSchema, manualApplicationSchema]);
export type Application = z.output<typeof applicationSchema>;
export type SearchApplication = z.output<typeof searchApplicationSchema>;
export type ManualApplication = z.output<typeof manualApplicationSchema>;
export const applicationsFileSchema = z.strictObject({
	schemaVersion: z.union([z.literal(2), z.literal(3)]),
	applications: z.array(applicationSchema),
	// Fingerprints of deleted rows of any origin, so a search never brings them back.
	deleted: z.array(fingerprint).default([]),
});
type ApplicationsFile = z.output<typeof applicationsFileSchema>;
export type ListState = Omit<ApplicationsFile, 'schemaVersion'>;
// The first file format, kept only so old workspaces can be migrated.
export const applicationsFileV1Schema = z.strictObject({
	schemaVersion: z.literal(1),
	applications: z.array(z.strictObject({ fingerprint, ...searchFound, matchedAt: timestamp })),
});

// What the workflow hands to the list: the list adds the job seeker's fields.
export type FoundApplication = Pick<SearchApplication, 'fingerprint' | 'job' | 'match' | 'addedAt'>;
export const manualInputSchema = z.strictObject({
	...manualFields,
	company: note.default(null),
	location: note.default(null),
	salary: note.default(null),
	status: statusSchema.default('new'),
	expectedSalary: expectedSalarySchema.default(null),
});
export type ManualInput = z.input<typeof manualInputSchema>;
// Which fields each kind of row may change; read-only fields are rejected, not ignored.
export const changesSchemas = {
	search: z
		.strictObject({
			status: statusSchema,
			expectedSalary: expectedSalarySchema,
			workArrangementOverride: arrangementOverrideSchema,
		})
		.partial(),
	manual: z.strictObject({ status: statusSchema, expectedSalary: expectedSalarySchema, ...manualFields }).partial(),
};
export type ApplicationChanges = z.input<(typeof changesSchemas)['manual']> &
	z.input<(typeof changesSchemas)['search']>;

export const inspectedEntrySchema = z.strictObject({
	fingerprint,
	// Accepted vacancies stay remembered after their row is deleted, so a search never finds them again.
	outcome: z.enum(['accepted', 'no-match', 'closed']),
	// Names of the failed criteria, so rejections can be reviewed without asking the model again.
	failed: z.array(z.string().min(1).max(50)).max(8).default([]),
	criteriaDigest: fingerprint,
	inspectedAt: timestamp,
	ref: jobRefSchema,
});
export type InspectedEntry = z.output<typeof inspectedEntrySchema>;

const counts = {
	processed: z.number().int().nonnegative(),
	matched: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
};
export const runEventSchema = z.discriminatedUnion('type', [
	z.strictObject({
		type: z.literal('started'),
		budgets: z.strictObject({
			process: z.number().int().positive(),
			match: z.number().int().positive(),
		}),
	}),
	z.strictObject({ type: z.literal('progress'), ...counts }),
	z.strictObject({ type: z.literal('application'), record: searchApplicationSchema }),
	z.strictObject({
		type: z.literal('job-failed'),
		ref: jobRefSchema,
		code: z.string().min(1).max(100),
	}),
	z.strictObject({
		type: z.literal('source-failed'),
		sourceId: sourceIdSchema,
		error: sourceFailureSchema,
	}),
	z.strictObject({
		type: z.literal('done'),
		reason: z.enum(['match-budget', 'process-budget', 'no-new', 'exhausted', 'cancelled', 'failed']),
		totals: z.strictObject(counts),
		costUsd: z.number().nonnegative(),
		unpricedCalls: z.number().int().nonnegative(),
		error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
	}),
]);
export type RunEvent = z.output<typeof runEventSchema>;
export type DoneEvent = Extract<RunEvent, { type: 'done' }>;
export type RunProgress = Omit<Extract<RunEvent, { type: 'progress' }>, 'type'>;

const workspace = z.string();
export const applicationsRequestSchema = z.discriminatedUnion('action', [
	z.strictObject({ action: z.literal('load'), workspace }),
	z.strictObject({ action: z.literal('add'), workspace, row: manualInputSchema }),
	// Checked against the row's own edit schema once the list knows its origin.
	z.strictObject({
		action: z.literal('update'),
		workspace,
		fingerprint,
		changes: z.record(z.string(), z.unknown()),
	}),
	z.strictObject({ action: z.literal('delete'), workspace, fingerprint }),
]);
export type ApplicationsRequest = z.input<typeof applicationsRequestSchema>;
export const runRequestSchema = z.strictObject({ workspace: z.string() });
export const loadResultSchema = z.strictObject({
	applications: z.array(
		z.discriminatedUnion('origin', [
			searchApplicationSchema.extend({ assessment: assessmentSchema }),
			manualApplicationSchema,
		]),
	),
	// Source names come from the search service so the table holds no source list of its own.
	sources: z.array(sourceDescriptorSchema),
});
export type LoadResult = z.output<typeof loadResultSchema>;
export const rowResultSchema = z.strictObject({ row: applicationSchema });
export const emptyResultSchema = z.strictObject({});

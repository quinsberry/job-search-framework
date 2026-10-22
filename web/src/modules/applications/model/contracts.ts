import { z } from 'zod';
import { jobDetailSchema, jobRefSchema, sourceFailureSchema, sourceIdSchema } from '@/shared/search-sources/contracts';

// Mirrors Search's MatchResult; modules share no runtime schemas, so `workflow.ts` type-checks that they stay in step.
export const matchSchema = z.strictObject({
	outcome: z.enum(['match', 'needs-clarification']),
	criteria: z
		.array(
			z.strictObject({
				criterion: z.enum([
					'availability',
					'salary',
					'workArrangement',
					'location',
					'role',
					'seniority',
					'positionType',
					'skills',
				]),
				result: z.enum(['met', 'failed', 'unknown']),
				evidence: z.enum(['structured', 'model']),
				detail: z.string().trim().min(1).max(2000),
			}),
		)
		.max(8),
	costUsd: z.number().nonnegative().nullable(),
});

const timestamp = z.iso.datetime({ offset: true });
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export const applicationSchema = z.strictObject({
	fingerprint,
	job: jobDetailSchema.omit({ description: true }),
	match: matchSchema,
	matchedAt: timestamp,
});
export type Application = z.output<typeof applicationSchema>;
export const applicationsFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	applications: z.array(applicationSchema),
});
export const inspectedEntrySchema = z.strictObject({
	fingerprint,
	outcome: z.enum(['no-match', 'closed']),
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
	z.strictObject({ type: z.literal('application'), record: applicationSchema }),
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
		reason: z.enum(['match-budget', 'process-budget', 'exhausted', 'cancelled', 'failed']),
		totals: z.strictObject(counts),
		costUsd: z.number().nonnegative(),
		unpricedCalls: z.number().int().nonnegative(),
		error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
	}),
]);
export type RunEvent = z.output<typeof runEventSchema>;
export type DoneEvent = Extract<RunEvent, { type: 'done' }>;
export type RunProgress = Omit<Extract<RunEvent, { type: 'progress' }>, 'type'>;

export const loadRequestSchema = z.strictObject({
	action: z.literal('load'),
	workspace: z.string(),
});
export const runRequestSchema = z.strictObject({ workspace: z.string() });
export const loadResultSchema = z.strictObject({
	applications: z.array(applicationSchema),
});

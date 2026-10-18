import { z } from 'zod';
import { profileDraftSchema, profileSchema } from './schema';
import type { ProfileDraft } from './schema';

export const recordSections = ['experience', 'education', 'certifications', 'languages'] as const;
export const recordIdsSchema = z.partialRecord(z.enum(recordSections), z.array(z.uuid()).max(100));
export type RecordIds = z.infer<typeof recordIdsSchema>;
export function recordIdsFor(values: ProfileDraft, existing: RecordIds = {}): RecordIds {
	return Object.fromEntries(
		recordSections.map((section) => [
			section,
			values[section].map((_, index) => existing[section]?.[index] ?? crypto.randomUUID()),
		]),
	);
}

export class ProfileError extends Error {
	constructor(
		public code: 'invalid' | 'conflict' | 'unavailable',
		message: string,
	) {
		super(message);
	}
}
export const jobSchema = z.strictObject({
	id: z.string(),
	cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
	source: z.string().regex(/^[a-f0-9]{64}\.(pdf|md)$/),
	provider: z.string().min(1),
	phase: z.enum(['reading', 'converting', 'validating', 'ready', 'failed', 'interrupted']),
	startedAt: z.number(),
	ownerPid: z.number(),
	ownerId: z.string(),
	error: z.string().optional(),
});
export const stateSchema = z.strictObject({
	schemaVersion: z.literal(1),
	recordIds: recordIdsSchema.default({}),
	draft: z.strictObject({ id: z.string(), values: profileDraftSchema, recordIds: recordIdsSchema }).nullable(),
	job: jobSchema.nullable(),
});
export const profileFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	profile: profileSchema,
	publication: z.strictObject({ draftId: z.string().nullable(), recordIds: recordIdsSchema }).optional(),
});
export type ProfileState = z.infer<typeof stateSchema>;
export type ConversionJob = z.infer<typeof jobSchema>;
export type ProfileSnapshot = ProfileState & { profile: z.infer<typeof profileSchema> | null; revision: string };
export const processing = (job: ConversionJob | null) =>
	!!job && ['reading', 'converting', 'validating'].includes(job.phase);
export const emptyState: ProfileState = { schemaVersion: 1, recordIds: {}, draft: null, job: null };

export const snapshotSchema = stateSchema.extend({ profile: profileSchema.nullable(), revision: z.string() });
export const profileResultSchema = z.object({ workspace: z.string(), snapshot: snapshotSchema });
export type ProfileResult = z.infer<typeof profileResultSchema>;
export const profileRequestSchema = z.discriminatedUnion('action', [
	z.strictObject({ action: z.literal('load'), workspace: z.string() }),
	z.strictObject({ action: z.literal('discard'), workspace: z.string(), revision: z.string() }),
	z.strictObject({
		action: z.literal('retry'),
		workspace: z.string(),
		revision: z.string(),
		provider: z.string().default('codex'),
	}),
	z.strictObject({
		action: z.enum(['edit', 'publish']),
		workspace: z.string(),
		revision: z.string(),
		values: profileDraftSchema,
		recordIds: recordIdsSchema,
	}),
]);
export type ProfileRequest = z.input<typeof profileRequestSchema>;

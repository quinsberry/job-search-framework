import { z } from 'zod';
import { searchPreferencesSchema } from '@/domain/matching/criteria';
import { preferencesDraftSchema } from './schema';

export const draftSchema = z.strictObject({ id: z.uuid(), values: preferencesDraftSchema });
export const configFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	preferences: searchPreferencesSchema,
	publication: z.strictObject({ draftId: z.uuid().nullable() }).optional(),
});
export const draftFileSchema = z.strictObject({ schemaVersion: z.literal(1), draft: draftSchema.nullable() });
export const snapshotSchema = z.strictObject({
	preferences: searchPreferencesSchema.nullable(),
	draft: draftSchema.nullable(),
	revision: z.string(),
});
export type PreferencesSnapshot = z.output<typeof snapshotSchema>;
export const resultSchema = z.strictObject({ workspace: z.string(), snapshot: snapshotSchema });
export const requestSchema = z.discriminatedUnion('action', [
	z.strictObject({ action: z.literal('load'), workspace: z.string() }),
	z.strictObject({ action: z.literal('discard'), workspace: z.string(), revision: z.string() }),
	z.strictObject({
		action: z.enum(['edit', 'publish']),
		workspace: z.string(),
		revision: z.string(),
		values: preferencesDraftSchema,
	}),
]);
export type PreferencesRequest = z.input<typeof requestSchema>;
export type PreferencesResult = z.output<typeof resultSchema>;

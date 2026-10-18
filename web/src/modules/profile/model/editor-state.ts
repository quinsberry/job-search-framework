import type { CandidateProfile, ProfileDraft } from './schema';
import { emptyProfile, profileSchema, toDraft } from './schema';

export function hasProfileChanges(values: ProfileDraft, saved: CandidateProfile | null) {
	const parsed = profileSchema.safeParse(values);
	const normalized = parsed.success ? toDraft(parsed.data) : values;
	return JSON.stringify(normalized) !== JSON.stringify(toDraft(saved ?? emptyProfile));
}
export function fieldMessages(error: unknown): string[] {
	if (!error || typeof error !== 'object') return [];
	if ('message' in error && typeof error.message === 'string') return [error.message];
	return [
		...new Set(
			Object.entries(error)
				.filter(([key]) => key !== 'ref')
				.flatMap(([, value]) => fieldMessages(value)),
		),
	];
}

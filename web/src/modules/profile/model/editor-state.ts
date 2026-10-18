import type { CandidateProfile, ProfileDraft } from './schema';
import { emptyProfile, profileSchema, toDraft } from './schema';

export function hasProfileChanges(values: ProfileDraft, saved: CandidateProfile | null) {
	const parsed = profileSchema.safeParse(values);
	const normalized = parsed.success ? toDraft(parsed.data) : values;
	return JSON.stringify(normalized) !== JSON.stringify(toDraft(saved ?? emptyProfile));
}
export { fieldMessages } from '@/shared/lib/field-messages';

import { searchPreferencesSchema, type SearchPreferences } from '@/domain/matching/criteria';
import { emptyPreferences, preferencesDraftSchema, type PreferencesDraft } from './schema';

const number = (value: string) => (value.trim() === '' ? undefined : Number(value));
export function toPreferences(values: PreferencesDraft) {
	return {
		targetPosition: {
			...values.targetPosition,
			salaryRange: values.targetPosition.salaryRange.map((band) => ({
				...band,
				min: number(band.min),
				desired: number(band.desired),
			})),
		},
		settings: {
			maxJobsToProcess: number(values.settings.maxJobsToProcess),
			maxJobsToMatch: number(values.settings.maxJobsToMatch),
			minSkillMatch: number(values.settings.minSkillMatch ?? ''),
		},
	};
}
export function toDraft(saved: SearchPreferences | null): PreferencesDraft {
	if (!saved) return structuredClone(emptyPreferences);
	return preferencesDraftSchema.parse({
		targetPosition: {
			...saved.targetPosition,
			location: {
				city: saved.targetPosition.location?.city ?? '',
				country: saved.targetPosition.location?.country ?? '',
			},
			salaryRange: saved.targetPosition.salaryRange.map((band) => ({
				...band,
				min: String(band.min),
				desired: band.desired === undefined ? '' : String(band.desired),
			})),
		},
		settings: {
			maxJobsToProcess: String(saved.settings.maxJobsToProcess),
			maxJobsToMatch: String(saved.settings.maxJobsToMatch),
			minSkillMatch: saved.settings.minSkillMatch === undefined ? '' : String(saved.settings.minSkillMatch),
		},
	});
}
export const formSchema = preferencesDraftSchema.superRefine((values, context) => {
	const result = searchPreferencesSchema.safeParse(toPreferences(values));
	if (!result.success)
		for (const issue of result.error.issues)
			context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
export function hasChanges(values: PreferencesDraft, saved: SearchPreferences | null) {
	const parsed = searchPreferencesSchema.safeParse(toPreferences(values));
	return JSON.stringify(parsed.success ? toDraft(parsed.data) : values) !== JSON.stringify(toDraft(saved));
}

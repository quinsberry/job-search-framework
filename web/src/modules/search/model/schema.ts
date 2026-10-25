import { z } from 'zod';
import { positionTypes, seniorities } from '@/domain/matching/criteria';
import { contractTypes, currencies, payPeriods, workArrangements } from '@/domain/vocabulary';

const text = z.string().max(20_000);

// Recovery retains unfinished text; only publication applies business validation.
const choice = <T extends string>(values: readonly [T, ...T[]]) => z.enum(['', ...values]);
export const salaryDraftSchema = z.strictObject({
	contractType: choice(contractTypes),
	currency: choice(currencies),
	period: choice(payPeriods),
	min: text,
	desired: text,
});
export const preferencesDraftSchema = z.strictObject({
	targetPosition: z.strictObject({
		positionTitles: z.array(text).max(200),
		seniority: z.array(z.enum(seniorities)).max(seniorities.length),
		location: z.strictObject({ city: text, country: text }),
		salaryRange: z.array(salaryDraftSchema).max(100),
		positionType: z.array(z.enum(positionTypes)).max(positionTypes.length),
		workArrangements: z.array(z.enum(workArrangements)).max(workArrangements.length),
	}),
	settings: z.strictObject({ maxJobsToProcess: text, maxJobsToMatch: text, minSkillMatch: text.optional() }),
});
export type PreferencesDraft = z.output<typeof preferencesDraftSchema>;
export const emptyPreferences: PreferencesDraft = {
	targetPosition: {
		positionTitles: [],
		seniority: [],
		location: { city: '', country: '' },
		salaryRange: [],
		positionType: [],
		workArrangements: [],
	},
	settings: { maxJobsToProcess: '', maxJobsToMatch: '', minSkillMatch: '' },
};
export const emptySalary: z.output<typeof salaryDraftSchema> = {
	contractType: '',
	currency: '',
	period: '',
	min: '',
	desired: '',
};

import { z } from 'zod';
import { contractTypes, currencies, payPeriods } from '@/shared/compensation';
export { contractTypes, currencies, payPeriods } from '@/shared/compensation';

export const seniorities = ['junior', 'middle', 'senior', 'staff'] as const;
export const positionTypes = ['full-time', 'part-time', 'contract', 'internship'] as const;
export const workArrangements = ['remote', 'on-site', 'hybrid'] as const;
const text = z.string().max(20_000);
const required = text.trim().min(1, 'Required');
const optionalText = text
	.trim()
	.optional()
	.transform((value) => value || undefined);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const selection = <T extends string>(values: readonly [T, ...T[]]) =>
	z
		.array(z.enum(values))
		.min(1, 'Select at least one option')
		.max(values.length)
		.refine(unique, 'Duplicate selections');

export const salaryBandSchema = z
	.strictObject({
		contractType: z.enum(contractTypes, { error: 'Choose a contract type' }),
		currency: z.enum(currencies, { error: 'Choose a currency' }),
		period: z.enum(payPeriods, { error: 'Choose a pay period' }),
		min: z.number({ error: 'Enter a valid baseline salary' }).positive('Baseline salary must be positive'),
		desired: z
			.number({ error: 'Enter a valid target salary' })
			.positive('Target salary must be positive')
			.optional(),
	})
	.refine((band) => band.desired === undefined || band.desired >= band.min, {
		path: ['desired'],
		message: 'Target salary must be at least the baseline',
	});
export const targetPositionSearchSchema = z
	.strictObject({
		positionTitles: z.array(required).min(1, 'Add at least one position title').max(200),
		seniority: selection(seniorities),
		location: z.strictObject({ city: optionalText, country: optionalText }).optional(),
		salaryRange: z.array(salaryBandSchema).max(100),
		positionType: selection(positionTypes),
		workArrangements: selection(workArrangements),
	})
	.superRefine((target, context) => {
		if (target.workArrangements.some((value) => value !== 'remote')) {
			for (const field of ['city', 'country'] as const) {
				if (!target.location?.[field])
					context.addIssue({
						code: 'custom',
						path: ['location', field],
						message: 'Required for hybrid or on-site work',
					});
			}
		}
	});
export const searchSettingsSchema = z
	.strictObject({
		minSkillMatch: z.number().int('Use a whole percentage').min(1).max(100).optional(),
		maxJobsToProcess: z
			.number({ error: 'Enter an inspection limit' })
			.int('Use a whole number')
			.positive('Must be greater than zero'),
		maxJobsToMatch: z
			.number({ error: 'Enter a desired result count' })
			.int('Use a whole number')
			.positive('Must be greater than zero'),
	})
	.refine((settings) => settings.maxJobsToMatch <= settings.maxJobsToProcess, {
		path: ['maxJobsToMatch'],
		message: 'Desired results cannot exceed the inspection limit',
	});
export const searchPreferencesSchema = z.strictObject({
	targetPosition: targetPositionSearchSchema,
	settings: searchSettingsSchema,
});

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
export type TargetPositionSearch = z.infer<typeof targetPositionSearchSchema>;
export type SearchSettings = z.infer<typeof searchSettingsSchema>;
export type SearchPreferences = z.output<typeof searchPreferencesSchema>;
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

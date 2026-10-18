import { z } from 'zod';

const text = z.string().max(20_000);
const list = z.array(text).max(200);
export const proficiencyLevels = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'] as const;
const proficiency = z.enum(proficiencyLevels);
const optionalText = text
	.trim()
	.optional()
	.transform((value) => value || undefined);
const optionalEmail = text
	.trim()
	.optional()
	.transform((value) => value || undefined)
	.pipe(z.email('Invalid email address').optional());
const optionalUrl = text
	.trim()
	.optional()
	.transform((value) => value || undefined)
	.pipe(z.url('Invalid URL').optional());

function validDate(value: string) {
	if (!/^\d{4}(-\d{2})?(-\d{2})?$/.test(value)) return false;
	const [year, month = 1, day = 1] = value.split('-').map(Number);
	if (year < 1 || month < 1 || month > 12 || day < 1) return false;
	return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
const date = optionalText.refine((value) => !value || validDate(value), 'Use a valid year, YYYY-MM or YYYY-MM-DD');
const endDate = optionalText.refine(
	(value) => !value || value === 'present' || validDate(value),
	'Use a valid date or present',
);
const required = (label: string) => text.trim().min(1, label + ' is required');
const experienceDraft = z.strictObject({
	company: text.default(''),
	role: text.default(''),
	startDate: text.default(''),
	endDate: text.default(''),
	achievements: list.default([]),
	technologies: list.default([]),
	description: text.default(''),
});
const educationDraft = z.strictObject({
	institution: text.default(''),
	degree: text.default(''),
	fieldOfStudy: text.default(''),
	startDate: text.default(''),
	endDate: text.default(''),
});
const certificationDraft = z.strictObject({
	name: text.default(''),
	issuingOrganization: text.default(''),
	issueDate: text.default(''),
	expirationDate: text.default(''),
	credentialId: text.default(''),
	credentialUrl: text.default(''),
});

export const profileDraftSchema = z.strictObject({
	identity: z
		.strictObject({
			fullName: text.default(''),
			location: text.default(''),
			email: text.default(''),
			phone: text.default(''),
			links: list.default([]),
			summary: text.default(''),
		})
		.prefault({}),
	experience: z.array(experienceDraft).max(100).default([]),
	skills: list.default([]),
	education: z.array(educationDraft).max(100).default([]),
	certifications: z.array(certificationDraft).max(100).default([]),
	languages: z
		.array(z.strictObject({ language: text.default(''), proficiency: proficiency.default('') }))
		.max(100)
		.default([]),
});
function orderedDates(value: { startDate?: string; endDate?: string }) {
	if (!value.startDate || !value.endDate || value.endDate === 'present') return true;
	const precision = Math.min(value.startDate.length, value.endDate.length);
	return value.startDate.slice(0, precision) <= value.endDate.slice(0, precision);
}
export const profileIdentitySchema = z.strictObject({
	fullName: required('Full name'),
	location: optionalText,
	email: optionalEmail,
	phone: optionalText,
	links: z.array(z.url('Invalid URL')).max(200).optional(),
	summary: optionalText,
});
export const experienceSchema = z
	.array(
		z
			.strictObject({
				company: required('Company name'),
				role: required('Role'),
				startDate: date,
				endDate,
				achievements: list.optional(),
				technologies: list.optional(),
				description: optionalText,
			})
			.refine(orderedDates, { message: 'End date must not precede start date', path: ['endDate'] }),
	)
	.max(100);
export const skillsSchema = z.array(required('Skill name')).max(200);
export const educationSchema = z
	.array(
		z
			.strictObject({
				institution: required('Institution name'),
				degree: optionalText,
				fieldOfStudy: optionalText,
				startDate: date,
				endDate,
			})
			.refine(orderedDates, { message: 'End date must not precede start date', path: ['endDate'] }),
	)
	.max(100);
export const certificationSchema = z
	.array(
		z
			.strictObject({
				name: required('Certification name'),
				issuingOrganization: optionalText,
				issueDate: date,
				expirationDate: date,
				credentialId: optionalText,
				credentialUrl: optionalUrl,
			})
			.refine((value) => orderedDates({ startDate: value.issueDate, endDate: value.expirationDate }), {
				message: 'Expiration must not precede issue date',
				path: ['expirationDate'],
			}),
	)
	.max(100);
export const languageProficienciesSchema = z
	.array(
		z.strictObject({
			language: required('Language'),
			proficiency: proficiency.optional().transform((value) => value || undefined),
		}),
	)
	.max(100);
export const profileSchema = z.strictObject({
	identity: profileIdentitySchema,
	experience: experienceSchema,
	skills: skillsSchema,
	education: educationSchema,
	certifications: certificationSchema,
	languages: languageProficienciesSchema,
});
export type CandidateProfile = z.output<typeof profileSchema>;
export type ProfileDraft = z.output<typeof profileDraftSchema>;
export const emptyProfile: ProfileDraft = profileDraftSchema.parse({});
export function toDraft(profile: CandidateProfile | ProfileDraft): ProfileDraft {
	return profileDraftSchema.parse(JSON.parse(JSON.stringify(profile)));
}

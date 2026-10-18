import { z } from 'zod';
import { emptyProfile, profileDraftSchema, profileSchema, toDraft, type ProfileDraft } from './schema';
import { recordIdsFor, type ProfileSnapshot, type RecordIds } from './contracts';

export type FormValues = Omit<ProfileDraft, 'experience' | 'education' | 'certifications' | 'languages'> & {
	experience: (ProfileDraft['experience'][number] & { rowId: string })[];
	education: (ProfileDraft['education'][number] & { rowId: string })[];
	certifications: (ProfileDraft['certifications'][number] & { rowId: string })[];
	languages: (ProfileDraft['languages'][number] & { rowId: string })[];
};
export function toFormValues(values: ProfileDraft, existing: RecordIds = {}): FormValues {
	values = structuredClone(values);
	const ids = recordIdsFor(values, existing);
	return {
		...values,
		experience: values.experience.map((row, i) => ({ ...row, rowId: ids.experience![i] })),
		education: values.education.map((row, i) => ({ ...row, rowId: ids.education![i] })),
		certifications: values.certifications.map((row, i) => ({ ...row, rowId: ids.certifications![i] })),
		languages: values.languages.map((row, i) => ({ ...row, rowId: ids.languages![i] })),
	};
}
export function fromFormValues(form: FormValues): { values: ProfileDraft; recordIds: RecordIds } {
	const strip = <T extends { rowId: string }>(rows: T[]) =>
		rows.map((row) => {
			const { rowId, ...facts } = row;
			void rowId;
			return facts;
		});
	return {
		values: {
			...form,
			experience: strip(form.experience),
			education: strip(form.education),
			certifications: strip(form.certifications),
			languages: strip(form.languages),
		},
		recordIds: {
			experience: form.experience.map((row) => row.rowId),
			education: form.education.map((row) => row.rowId),
			certifications: form.certifications.map((row) => row.rowId),
			languages: form.languages.map((row) => row.rowId),
		},
	};
}
export const initialFormValues = (snapshot: ProfileSnapshot) =>
	toFormValues(
		toDraft(snapshot.draft?.values ?? snapshot.profile ?? emptyProfile),
		snapshot.draft?.recordIds ?? snapshot.recordIds,
	);
const rowId = { rowId: z.uuid() };
const formDraftSchema = profileDraftSchema.extend({
	experience: z.array(profileDraftSchema.shape.experience.unwrap().element.extend(rowId)),
	education: z.array(profileDraftSchema.shape.education.unwrap().element.extend(rowId)),
	certifications: z.array(profileDraftSchema.shape.certifications.unwrap().element.extend(rowId)),
	languages: z.array(profileDraftSchema.shape.languages.unwrap().element.extend(rowId)),
});
export const formValidationSchema = formDraftSchema.superRefine((form, context) => {
	const parsed = profileSchema.safeParse(fromFormValues(form).values);
	if (!parsed.success)
		for (const issue of parsed.error.issues)
			context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
export const newExperience = () => ({
	...profileDraftSchema.shape.experience.unwrap().element.parse({}),
	rowId: crypto.randomUUID(),
});
export const newEducation = () => ({
	...profileDraftSchema.shape.education.unwrap().element.parse({}),
	rowId: crypto.randomUUID(),
});
export const newCertification = () => ({
	...profileDraftSchema.shape.certifications.unwrap().element.parse({}),
	rowId: crypto.randomUUID(),
});
export const newLanguage = () => ({
	...profileDraftSchema.shape.languages.unwrap().element.parse({}),
	rowId: crypto.randomUUID(),
});

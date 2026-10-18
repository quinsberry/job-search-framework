import { expect, test } from 'bun:test';
import { emptyProfile, toDraft } from './schema';
import { toFormValues, fromFormValues, newExperience, formValidationSchema } from './form-model';
import { hasProfileChanges } from './editor-state';
test('row identities survive removal and editing without leaking into professional facts', () => {
	const values = toDraft({
		...emptyProfile,
		experience: [
			{ company: 'First', role: 'Engineer' },
			{ company: 'Second', role: 'Engineer' },
		],
	} as Parameters<typeof toDraft>[0]);
	const form = toFormValues(values);
	const survivor = form.experience[1].rowId;
	form.experience.splice(0, 1);
	form.experience[0].role = 'Senior Engineer';
	const mapped = fromFormValues(form);
	expect(mapped.recordIds.experience).toEqual([survivor]);
	expect(mapped.values.experience[0]).not.toHaveProperty('rowId');
	expect(toFormValues(mapped.values, mapped.recordIds).experience[0].rowId).toBe(survivor);
	expect(newExperience().achievements).toEqual([]);
});
test('form validation keeps nested error paths, and normalized reversal disables Save', () => {
	const form = toFormValues({
		...emptyProfile,
		identity: { ...emptyProfile.identity, fullName: 'Alex', links: ['invalid'] },
		skills: [''],
	});
	const result = formValidationSchema.safeParse(form);
	expect(result.success).toBe(false);
	if (!result.success)
		expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['identity.links.0', 'skills.0']);
	form.identity.links = [];
	form.skills = [];
	const validated = formValidationSchema.parse(form);
	expect(
		hasProfileChanges(fromFormValues(form).values, {
			...validated,
			experience: [],
			education: [],
			certifications: [],
			languages: [],
		}),
	).toBe(false);
});

import { expect, test } from 'bun:test';
import { fieldMessages, hasProfileChanges } from './editor-state';
import { emptyProfile, profileSchema, toDraft } from './schema';

test('restoring saved values disables Save even when the recovered draft started differently', () => {
	const saved = profileSchema.parse({ ...emptyProfile, identity: { fullName: 'Alex Saved' } });
	const recovered = { ...toDraft(saved), identity: { ...toDraft(saved).identity, fullName: 'Alex Draft' } };
	expect(hasProfileChanges(recovered, saved)).toBe(true);
	recovered.identity.fullName = 'Alex Saved';
	expect(hasProfileChanges(recovered, saved)).toBe(false);
});
test('nested list errors produce visible messages for invalid links and empty skills', () => {
	expect(fieldMessages([{ message: 'Invalid URL', type: 'invalid_format' }])).toEqual(['Invalid URL']);
	expect(
		fieldMessages({ 0: { message: 'Skill name is required' }, 1: { message: 'Skill name is required' } }),
	).toEqual(['Skill name is required']);
});

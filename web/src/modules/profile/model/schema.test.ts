import { describe, expect, test } from 'bun:test';
import { emptyProfile, profileDraftSchema, profileSchema } from './schema';

describe('candidate profile validation', () => {
	test('only accepts the fixed proficiency levels in drafts and published profiles', () => {
		for (const proficiency of ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'] as const) {
			const values = {
				...emptyProfile,
				identity: { fullName: 'Alex' },
				languages: [{ language: 'English', proficiency }],
			};
			expect(profileDraftSchema.parse(values).languages[0].proficiency).toBe(proficiency);
			expect(profileSchema.parse(values).languages[0].proficiency).toBe(proficiency || undefined);
		}
		const values = {
			...emptyProfile,
			identity: { fullName: 'Alex' },
			languages: [{ language: 'English', proficiency: 'fluent' }],
		};
		expect(profileDraftSchema.safeParse(values).success).toBe(false);
		expect(profileSchema.safeParse(values).success).toBe(false);
		expect(profileDraftSchema.parse({ languages: [{ language: 'English' }] }).languages[0].proficiency).toBe('');
	});
	test('keeps incomplete imports editable but requires a name to publish', () => {
		expect(profileDraftSchema.parse(emptyProfile).identity.fullName).toBe('');
		expect(profileSchema.safeParse(emptyProfile).success).toBe(false);
		const result = profileSchema.parse({ ...emptyProfile, identity: { fullName: 'Alex Example', email: '' } });
		expect(result.identity.email).toBeUndefined();
	});
	test('preserves lists and partial dates while rejecting impossible dates and unsupported fields', () => {
		const profile = {
			...emptyProfile,
			identity: { fullName: 'Alex' },
			experience: [
				{
					company: 'Example',
					role: 'Engineer',
					startDate: '2021',
					endDate: 'present',
					achievements: ['Built checkout', 'Reduced latency'],
					technologies: ['C++', 'TypeScript'],
				},
			],
		};
		expect(profileSchema.parse(profile).experience[0].startDate).toBe('2021');
		expect(profileSchema.parse(profile).experience[0].technologies).toEqual(['C++', 'TypeScript']);
		expect(profileSchema.safeParse({ ...profile, projects: [] }).success).toBe(false);
		expect(
			profileSchema.safeParse({ ...profile, experience: [{ ...profile.experience[0], startDate: '2025-02-30' }] })
				.success,
		).toBe(false);
		expect(
			profileSchema.safeParse({
				...profile,
				experience: [{ ...profile.experience[0], startDate: '2025', endDate: '2020' }],
			}).success,
		).toBe(false);
	});
});

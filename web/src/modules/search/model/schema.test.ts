import { expect, test } from 'bun:test';
import { emptyPreferences, emptySalary, preferencesDraftSchema, searchPreferencesSchema } from './schema';
import { formSchema, hasChanges, toDraft, toPreferences } from './form-model';

export const validPreferences = () => ({
	targetPosition: {
		positionTitles: ['  Frontend Engineer  '],
		seniority: ['senior'],
		positionType: ['full-time'],
		workArrangements: ['remote'],
		salaryRange: [],
	},
	settings: { maxJobsToProcess: 100, maxJobsToMatch: 10 },
});
test('saved preferences normalize titles, allow no salary, and require residence for office work', () => {
	const values = validPreferences();
	expect(searchPreferencesSchema.parse(values).targetPosition.positionTitles).toEqual(['Frontend Engineer']);
	values.targetPosition.workArrangements = ['hybrid'];
	const invalid = searchPreferencesSchema.safeParse(values);
	expect(invalid.success).toBe(false);
	if (!invalid.success)
		expect(invalid.error.issues.map((issue) => issue.path.join('.'))).toEqual([
			'targetPosition.location.city',
			'targetPosition.location.country',
		]);
	expect(
		searchPreferencesSchema.safeParse({
			...values,
			targetPosition: { ...values.targetPosition, location: { city: 'Warsaw', country: 'Poland' } },
		}).success,
	).toBe(true);
});
test('strict saved validation rejects blank titles, duplicates, invalid counts and unsupported fields', () => {
	const saved = validPreferences();
	for (const target of [
		{ positionTitles: [' '] },
		{ seniority: ['senior', 'senior'] },
		{ remoteOption: 'remote' },
		{ workArrangements: [] },
	]) {
		expect(
			searchPreferencesSchema.safeParse({ ...saved, targetPosition: { ...saved.targetPosition, ...target } })
				.success,
		).toBe(false);
	}
	for (const settings of [
		{ maxJobsToProcess: 1.5, maxJobsToMatch: 1 },
		{ maxJobsToProcess: 0, maxJobsToMatch: 1 },
		{ maxJobsToProcess: 1, maxJobsToMatch: 2 },
	]) {
		expect(searchPreferencesSchema.safeParse({ ...saved, settings }).success).toBe(false);
	}
});
test('salary baseline and optional target share units; invalid or legacy endpoints fail', () => {
	const saved = validPreferences();
	const band = {
		contractType: 'B2B',
		currency: 'PLN',
		period: 'month',
		min: 20_000,
		desired: 30_000,
	};
	const check = (salary: unknown) =>
		searchPreferencesSchema.safeParse({
			...saved,
			targetPosition: { ...saved.targetPosition, salaryRange: [salary] },
		});
	expect(check(band).success).toBe(true);
	expect(check({ ...band, desired: undefined }).success).toBe(true);
	for (const extra of [{ min: -1 }, { desired: 1 }, { min: Infinity }, { desired: NaN }, { max: 30_000 }])
		expect(check({ ...band, ...extra }).success).toBe(false);
});
test('drafts retain invalid numeric text and empty choices; saved normalization compares against baseline', () => {
	const values = structuredClone(emptyPreferences);
	values.settings.maxJobsToProcess = 'not yet';
	values.targetPosition.salaryRange = [{ ...emptySalary, min: '12.' }];
	expect(preferencesDraftSchema.parse(values)).toEqual(values);
	expect(formSchema.safeParse(values).success).toBe(false);
	expect(toPreferences(emptyPreferences).settings.maxJobsToProcess).toBeUndefined();
	const saved = searchPreferencesSchema.parse(validPreferences());
	expect(formSchema.safeParse(toDraft(saved)).success).toBe(true);
	expect(hasChanges(toDraft(saved), saved)).toBe(false);
	expect(hasChanges(values, saved)).toBe(true);
});

test('optional skill threshold validates 1–100 and round-trips without changing old configs', () => {
	const old = searchPreferencesSchema.parse(validPreferences());
	expect(old.settings.minSkillMatch).toBeUndefined();
	expect(toDraft(old).settings.minSkillMatch).toBe('');
	for (const minSkillMatch of [1, 50, 100]) {
		const saved = searchPreferencesSchema.parse({ ...old, settings: { ...old.settings, minSkillMatch } });
		expect(toDraft(saved).settings.minSkillMatch).toBe(String(minSkillMatch));
		expect(searchPreferencesSchema.parse(toPreferences(toDraft(saved))).settings).toEqual(saved.settings);
		expect(hasChanges(toDraft(saved), saved)).toBe(false);
	}
	for (const minSkillMatch of [0, 101, 0.5, NaN, Infinity, '50'])
		expect(
			searchPreferencesSchema.safeParse({ ...old, settings: { ...old.settings, minSkillMatch } }).success,
		).toBe(false);
	const legacy = toDraft(old);
	delete legacy.settings.minSkillMatch;
	expect(preferencesDraftSchema.safeParse(legacy).success).toBe(true);
	expect(formSchema.safeParse(legacy).success).toBe(true);
	for (const value of ['not yet', '0', '101', '50.5']) {
		const draft = toDraft(old);
		draft.settings.minSkillMatch = value;
		expect(preferencesDraftSchema.parse(draft).settings.minSkillMatch).toBe(value);
		expect(formSchema.safeParse(draft).success).toBe(false);
	}
});

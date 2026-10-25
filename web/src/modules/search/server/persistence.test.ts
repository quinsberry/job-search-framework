import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFileSchema } from '../model/contracts';
import { YAML } from 'bun';
import { WorkspaceFiles } from '@/shared/server/workspace-files';
import { searchPreferencesSchema } from '@/domain/matching/criteria';
import { emptyPreferences, emptySalary } from '../model/schema';
import { toDraft } from '../model/form-model';
import { PreferencesRepository } from './persistence';

const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const path = await mkdtemp(join(tmpdir(), 'preferences-test-'));
	folders.push(path);
	return { path, repo: await PreferencesRepository.open(path) };
}
const valid = () =>
	toDraft(
		searchPreferencesSchema.parse({
			targetPosition: {
				positionTitles: ['Engineer'],
				seniority: ['senior'],
				positionType: ['full-time'],
				workArrangements: ['remote'],
				salaryRange: [],
			},
			settings: { maxJobsToProcess: 100, maxJobsToMatch: 10 },
		}),
	);
test('incomplete recovery survives reopening without publication; Save and Discard keep active preferences separate', async () => {
	const { repo, path } = await setup();
	const unfinished = structuredClone(emptyPreferences);
	unfinished.settings.maxJobsToProcess = 'not a number';
	unfinished.targetPosition.salaryRange.push({ ...emptySalary, min: '1.' });
	const draft = await repo.edit(unfinished, (await repo.load()).revision);
	expect((await PreferencesRepository.open(path).then((repo) => repo.load())).draft?.values).toEqual(unfinished);
	await expect(repo.publish(unfinished, draft.revision)).rejects.toThrow();
	expect((await repo.load()).preferences).toBeNull();
	const saved = await repo.publish(valid(), draft.revision);
	expect(saved.draft).toBeNull();
	expect(saved.preferences?.settings.maxJobsToMatch).toBe(10);
	const config = await Bun.file(join(path, 'search-preferences/config.yaml')).text();
	expect(configFileSchema.parse(YAML.parse(config)).preferences.targetPosition.positionTitles).toEqual(['Engineer']);
	const edited = await repo.edit(unfinished, saved.revision);
	const discarded = await repo.discard(edited.revision);
	expect(discarded.preferences).toEqual(saved.preferences);
	expect(discarded.draft).toBeNull();
});
test('concurrent revisions, malformed YAML and symlinked storage never silently overwrite data', async () => {
	const { path, repo } = await setup();
	const initial = await repo.load();
	const draft = await repo.edit(valid(), initial.revision);
	await expect(repo.edit(emptyPreferences, initial.revision)).rejects.toThrow('changed');
	await expect(repo.discard(initial.revision)).rejects.toThrow('changed');
	await repo.publish(valid(), draft.revision);
	const file = join(path, 'search-preferences/config.yaml');
	const original = await Bun.file(file).text();
	await Bun.write(file, original + '\nunknown: true\n');
	await expect(repo.load()).rejects.toThrow();
	expect(await Bun.file(file).text()).toBe(original + '\nunknown: true\n');
	await rm(file);
	await symlink(join(path, 'outside.yaml'), file);
	await expect(repo.load()).rejects.toThrow('symbolic');
});
test('external config edits invalidate writes even if the draft file did not change', async () => {
	const { path, repo } = await setup();
	const saved = await repo.publish(valid(), (await repo.load()).revision);
	const file = join(path, 'search-preferences/config.yaml');
	await Bun.write(file, (await Bun.file(file).text()).replace('Engineer', 'External'));
	await expect(repo.edit(valid(), saved.revision)).rejects.toThrow('changed');
	expect((await repo.load()).preferences?.targetPosition.positionTitles).toEqual(['External']);
});
test('failed publication preserves old data; committed Save survives interrupted draft cleanup', async () => {
	const { path, repo } = await setup();
	const saved = await repo.publish(valid(), (await repo.load()).revision);
	const next = valid();
	next.targetPosition.positionTitles = ['Changed'];
	const draft = await repo.edit(next, saved.revision);
	const originalWrite = WorkspaceFiles.prototype.write;
	let failFile = 'config.yaml';
	const fault = spyOn(WorkspaceFiles.prototype, 'write').mockImplementation(async function (
		this: WorkspaceFiles,
		name,
		value,
	) {
		if (name === failFile) throw new Error('disk full');
		return originalWrite.call(this, name, value);
	});
	try {
		await expect(repo.publish(next, draft.revision)).rejects.toThrow('disk full');
		expect((await repo.load()).preferences).toEqual(saved.preferences);
		expect((await repo.load()).draft?.values).toEqual(next);
		failFile = 'draft.yaml';
		const committed = await repo.publish(next, draft.revision);
		expect(committed.preferences?.targetPosition.positionTitles).toEqual(['Changed']);
		expect(committed.draft).toBeNull();
	} finally {
		fault.mockRestore();
	}
	const reopened = await PreferencesRepository.open(path);
	const committed = await reopened.load();
	expect(committed.draft).toBeNull();
	const changed = await reopened.edit(valid(), committed.revision);
	expect(changed.draft?.id).not.toBe(draft.draft?.id);
});

test('skill threshold survives draft recovery and saved YAML; old configs and drafts still load', async () => {
	const { repo, path } = await setup();
	const values = valid();
	values.settings.minSkillMatch = '65';
	const edited = await repo.edit(values, (await repo.load()).revision);
	const recovered = await PreferencesRepository.open(path).then((repo) => repo.load());
	expect(recovered.draft?.values.settings.minSkillMatch).toBe('65');
	const saved = await repo.publish(values, edited.revision);
	expect(saved.preferences?.settings.minSkillMatch).toBe(65);
	const reopened = await PreferencesRepository.open(path).then((repo) => repo.load());
	expect(reopened.preferences?.settings.minSkillMatch).toBe(65);
	const cleared = valid();
	cleared.settings.minSkillMatch = '';
	const without = await repo.publish(cleared, reopened.revision);
	expect(without.preferences?.settings.minSkillMatch).toBeUndefined();
	const legacy = valid();
	delete legacy.settings.minSkillMatch;
	await repo.edit(legacy, without.revision);
	expect(
		(await PreferencesRepository.open(path).then((repo) => repo.load())).draft?.values.settings.minSkillMatch,
	).toBeUndefined();
});

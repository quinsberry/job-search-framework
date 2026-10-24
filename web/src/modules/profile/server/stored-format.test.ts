import { afterEach, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileRepository } from './persistence';

// Golden files written by the current repository, with fictional data. Never write to them, only to copies.
const fixture = (name: string) => join(import.meta.dir, 'fixtures', name);
const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function workspaceWith(...names: string[]) {
	const workspace = await mkdtemp(join(tmpdir(), 'stored-format-'));
	folders.push(workspace);
	await mkdir(join(workspace, 'candidate-profile'));
	for (const name of names) await copyFile(fixture(name), join(workspace, 'candidate-profile', name));
	return workspace;
}
const stored = (workspace: string, name: string) => readFile(join(workspace, 'candidate-profile', name), 'utf8');

// Published without a pending draft, so saving it again keeps `draftId: null`.
test('a saved profile is byte-identical after saving it unchanged', async () => {
	const workspace = await workspaceWith('profile.yaml');
	const repo = await ProfileRepository.open(workspace);
	const { profile, recordIds, revision } = await repo.load();
	await repo.publish(profile, revision, recordIds);
	expect(await stored(workspace, 'profile.yaml')).toBe(await readFile(fixture('profile.yaml'), 'utf8'));
});

test('a profile draft from a finished conversion is byte-identical after an unchanged edit', async () => {
	const workspace = await workspaceWith('profile.yaml', 'draft.yaml');
	const repo = await ProfileRepository.open(workspace);
	const { draft, revision } = await repo.load();
	await repo.edit(draft!.values, revision, draft!.recordIds);
	expect(await stored(workspace, 'draft.yaml')).toBe(await readFile(fixture('draft.yaml'), 'utf8'));
	expect(await stored(workspace, 'profile.yaml')).toBe(await readFile(fixture('profile.yaml'), 'utf8'));
});

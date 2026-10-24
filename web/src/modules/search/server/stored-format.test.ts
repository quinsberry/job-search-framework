import { afterEach, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toDraft } from '../model/form-model';
import { PreferencesRepository } from './persistence';

// Golden files written by the current repository, with fictional data. Never write to them, only to copies.
const fixture = (name: string) => join(import.meta.dir, 'fixtures', name);
const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function workspaceWith(...names: string[]) {
	const workspace = await mkdtemp(join(tmpdir(), 'stored-format-'));
	folders.push(workspace);
	await mkdir(join(workspace, 'search-preferences'));
	for (const name of names) await copyFile(fixture(name), join(workspace, 'search-preferences', name));
	return workspace;
}
const stored = (workspace: string, name: string) => readFile(join(workspace, 'search-preferences', name), 'utf8');

// Saved without a pending draft, so saving it again keeps `draftId: null`. The editor round-trips
// through its form values, so this also covers the form conversion the app applies.
test('saved search preferences are byte-identical after saving them unchanged', async () => {
	const workspace = await workspaceWith('config.yaml');
	const repo = await PreferencesRepository.open(workspace);
	const { preferences, revision } = await repo.load();
	await repo.publish(toDraft(preferences), revision);
	expect(await stored(workspace, 'config.yaml')).toBe(await readFile(fixture('config.yaml'), 'utf8'));
});

test('a search preferences draft is byte-identical after an unchanged edit', async () => {
	const workspace = await workspaceWith('config.yaml', 'draft.yaml');
	const repo = await PreferencesRepository.open(workspace);
	const { draft, revision } = await repo.load();
	await repo.edit(draft!.values, revision);
	expect(await stored(workspace, 'draft.yaml')).toBe(await readFile(fixture('draft.yaml'), 'utf8'));
	expect(await stored(workspace, 'config.yaml')).toBe(await readFile(fixture('config.yaml'), 'utf8'));
});

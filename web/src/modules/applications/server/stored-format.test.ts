import { afterEach, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationList } from './application-list';
import { SearchMemory } from './search-memory';

// Golden files written by the app; see fixtures/README.md. Never write to them, only to copies.
const fixture = (name: string) => join(import.meta.dir, 'fixtures', name);
const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function workspaceWith(files: Record<string, string>) {
	const workspace = await mkdtemp(join(tmpdir(), 'stored-format-'));
	folders.push(workspace);
	for (const [target, name] of Object.entries(files)) {
		await mkdir(join(workspace, target, '..'), { recursive: true });
		await copyFile(fixture(name), join(workspace, target));
	}
	return workspace;
}
const LIST = 'applications/applications.json';
const INDEX = 'search-runs/inspected.jsonl';

test('a v2 application list opens with the same rows as v3, and its first write is the v3 file', async () => {
	const v2 = await workspaceWith({ [LIST]: 'applications-v2.json' });
	const v3 = await workspaceWith({ [LIST]: 'applications-v3.json' });
	const list = await ApplicationList.open(v2);
	const rows = await list.list();
	expect(rows).toEqual(await (await ApplicationList.open(v3)).list());

	await list.update(rows[0].fingerprint, {});
	expect(await readFile(join(v2, LIST), 'utf8')).toBe(await readFile(fixture('applications-v3.json'), 'utf8'));
});

test('a v3 application list is byte-identical after an unchanged update', async () => {
	const workspace = await workspaceWith({ [LIST]: 'applications-v3.json' });
	const list = await ApplicationList.open(workspace);
	for (const row of await list.list()) await list.update(row.fingerprint, {});
	expect(await readFile(join(workspace, LIST), 'utf8')).toBe(await readFile(fixture('applications-v3.json'), 'utf8'));
});

test('search memory keeps every entry and its bytes when prepared under the same criteria', async () => {
	const workspace = await workspaceWith({ [INDEX]: 'inspected.jsonl' });
	const memory = await SearchMemory.open(workspace);
	// The digest every fixture entry was judged under, and a time inside the 60-day window.
	await memory.prepare(
		'46ac875f5ca76578ce08bf3f50c3ec2ff56064d1f48868bbf2d50fbb3b709b2d',
		new Date('2026-11-01T00:00:00Z'),
	);
	expect(['1', '2', '3', '4'].map((digit) => memory.has(digit.repeat(64)))).toEqual([true, true, true, true]);
	expect(await readFile(join(workspace, INDEX), 'utf8')).toBe(await readFile(fixture('inspected.jsonl'), 'utf8'));
});

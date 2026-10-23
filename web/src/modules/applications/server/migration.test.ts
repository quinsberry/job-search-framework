import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationList } from './application-list';
import { migrateWorkspace } from './migration';
import { parseIndex, SearchMemory } from './search-memory';

let workspace: string;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'migration-'));
});
afterEach(() => rm(workspace, { recursive: true, force: true }));

const ref = (id: string) => ({
	sourceId: 'linkedin',
	sourceJobId: id,
	url: `https://www.linkedin.com/jobs/view/${id}`,
});
const v1Application = (id: string) => ({
	fingerprint: id.repeat(64),
	job: {
		...ref(id),
		title: `Engineer ${id}`,
		company: { name: 'Acme', url: null },
		locations: [],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		availability: 'open',
	},
	match: { outcome: 'needs-clarification', criteria: [], costUsd: 0.0001 },
	matchedAt: '2026-10-22T00:00:00Z',
});
const rejected = {
	fingerprint: 'c'.repeat(64),
	outcome: 'no-match',
	failed: ['location'],
	criteriaDigest: 'd'.repeat(64),
	inspectedAt: '2026-10-22T00:00:00Z',
	ref: ref('c'),
};
async function writeV1() {
	await mkdir(join(workspace, 'applications'), { recursive: true });
	await writeFile(
		join(workspace, 'applications', 'applications.json'),
		JSON.stringify({ schemaVersion: 1, applications: [v1Application('a'), v1Application('b')] }),
	);
	// A truncated last line from an interrupted append must not break the move.
	await writeFile(join(workspace, 'applications', 'inspected.jsonl'), JSON.stringify(rejected) + '\n{"finger');
}
const memoryLines = async () => parseIndex(await readFile(join(workspace, 'search-runs', 'inspected.jsonl'), 'utf8'));

test('a v1 workspace keeps every application and rejection, and rerunning is harmless', async () => {
	await writeV1();
	await migrateWorkspace(workspace);
	await migrateWorkspace(workspace);

	const rows = await (await ApplicationList.open(workspace)).list();
	expect(rows).toHaveLength(2);
	expect(rows[0]).toMatchObject({
		origin: 'search',
		status: 'new',
		expectedSalary: null,
		addedAt: '2026-10-22T00:00:00Z',
		fingerprint: 'a'.repeat(64),
	});
	expect((await memoryLines()).map((entry) => [entry.outcome, entry.fingerprint[0]])).toEqual([
		['no-match', 'c'],
		['accepted', 'a'],
		['accepted', 'b'],
	]);
	await expect(stat(join(workspace, 'applications', 'inspected.jsonl'))).rejects.toThrow();

	// Accepted vacancies survive the pruning that a criteria change applies to rejections.
	const memory = await SearchMemory.open(workspace);
	await memory.prepare('e'.repeat(64), new Date('2027-06-01T00:00:00Z'));
	expect([memory.has('a'.repeat(64)), memory.has('c'.repeat(64))]).toEqual([true, false]);
});

test('an interrupted migration finishes on the next open', async () => {
	await writeV1();
	// As if the process died after writing memory but before upgrading the list.
	await mkdir(join(workspace, 'search-runs'));
	await writeFile(join(workspace, 'search-runs', 'inspected.jsonl'), JSON.stringify(rejected) + '\n');
	await migrateWorkspace(workspace);
	expect(await (await ApplicationList.open(workspace)).list()).toHaveLength(2);
	expect(new Set((await memoryLines()).map((entry) => entry.fingerprint)).size).toBe(3);
});

test('an empty or already migrated workspace is left alone', async () => {
	await migrateWorkspace(workspace);
	await expect(stat(join(workspace, 'search-runs', 'inspected.jsonl'))).rejects.toThrow();
});

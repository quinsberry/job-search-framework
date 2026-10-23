import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FoundApplication } from '../model/contracts';
import { ApplicationList } from './application-list';
import { manualFingerprint } from './fingerprint';

let workspace: string;
let list: ApplicationList;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'application-list-'));
	list = await ApplicationList.open(workspace);
});
afterEach(() => rm(workspace, { recursive: true, force: true }));

const NOW = new Date('2026-10-23T12:00:00Z');
const found: FoundApplication = {
	fingerprint: 'a'.repeat(64),
	job: {
		sourceId: 'linkedin',
		sourceJobId: '1',
		url: 'https://www.linkedin.com/jobs/view/1',
		title: 'Angular Developer',
		company: { name: 'Sii Poland', url: null },
		locations: [{ label: 'Warsaw, Poland', city: 'Warsaw', country: 'Poland' }],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		availability: 'open',
	},
	match: { outcome: 'needs-clarification', criteria: [], costUsd: null },
	addedAt: '2026-10-22T00:00:00Z',
};
const manual = {
	url: 'https://example.com/job',
	title: 'Frontend Engineer',
	company: 'Acme',
	location: 'Warsaw, Poland',
};

test('found vacancies start as new; manual rows default the optional fields', async () => {
	expect(await list.add(found)).toMatchObject({ origin: 'search', status: 'new', expectedSalary: null });
	const row = await list.addManual({ ...manual, salary: '  ' }, NOW);
	expect(row).toMatchObject({ origin: 'manual', status: 'new', salary: null, addedAt: NOW.toISOString() });
	expect(row.fingerprint).toBe(manualFingerprint({ ...manual }));
	expect((await list.list()).map((item) => item.origin)).toEqual(['search', 'manual']);
	expect(await list.has(found.fingerprint)).toBe(true);
});

test('duplicates are refused on add and on identity-changing edits', async () => {
	await list.addManual(manual, NOW);
	await expect(list.addManual({ ...manual, url: 'https://example.com/other' }, NOW)).rejects.toMatchObject({
		code: 'conflict',
	});
	const other = await list.addManual({ ...manual, title: 'Backend Engineer' }, NOW);
	await expect(list.update(other.fingerprint, { title: 'Frontend Engineer' })).rejects.toMatchObject({
		code: 'conflict',
	});
});

test('each origin may change only its own fields', async () => {
	await list.add(found);
	expect(await list.update(found.fingerprint, { status: 'applied', expectedSalary: '25k PLN B2B' })).toMatchObject({
		status: 'applied',
		expectedSalary: '25k PLN B2B',
	});
	await expect(list.update(found.fingerprint, { title: 'Changed' })).rejects.toThrow();
	await expect(list.update(found.fingerprint, { fingerprint: 'b'.repeat(64) })).rejects.toThrow();

	const row = await list.addManual(manual, NOW);
	const edited = await list.update(row.fingerprint, { company: 'Acme Corp', salary: '20k' });
	expect(edited).toMatchObject({ company: 'Acme Corp', salary: '20k' });
	expect(edited.fingerprint).toBe(manualFingerprint({ ...manual, company: 'Acme Corp' }));
	await expect(list.update(edited.fingerprint, { addedAt: NOW.toISOString() })).rejects.toThrow();
});

test('remove deletes one row and reports rows that are gone', async () => {
	await list.add(found);
	await list.remove(found.fingerprint);
	expect(await list.list()).toEqual([]);
	await expect(list.remove(found.fingerprint)).rejects.toMatchObject({ code: 'not-found' });
	await expect(list.update(found.fingerprint, { status: 'offer' })).rejects.toMatchObject({ code: 'not-found' });
});

test('writes from two stores re-read the file, so none is lost', async () => {
	const other = await ApplicationList.open(workspace);
	await Promise.all([list.add(found), other.addManual(manual, NOW)]);
	expect(await list.list()).toHaveLength(2);
});

test('deleted rows of any origin stay known until added back by hand', async () => {
	await list.add(found);
	const manualRow = await list.addManual(manual, NOW);
	await list.remove(found.fingerprint);
	await list.remove(manualRow.fingerprint);
	expect(await list.list()).toEqual([]);
	expect([await list.has(found.fingerprint), await list.has(manualRow.fingerprint)]).toEqual([true, true]);

	await list.addManual(manual, NOW);
	await list.remove(manualRow.fingerprint);
	await list.addManual(manual, NOW);
	expect(await list.list()).toHaveLength(1);
});

test('an empty or malformed link is a validation error, not a crash', async () => {
	for (const url of ['', 'not a url'])
		await expect(list.addManual({ ...manual, url }, NOW)).rejects.toMatchObject({ name: 'ZodError' });
});

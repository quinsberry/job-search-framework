import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';
import { ApplicationList } from '@/modules/applications/server/application-list';
import { loadResultSchema } from '@/modules/applications/model/contracts';
import { PreferencesRepository } from '@/modules/search/server/persistence';
import { toDraft } from '@/modules/search/model/form-model';
import { searchPreferencesSchema } from '@/domain/matching/criteria';

let workspace: string;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'applications-actions-'));
});
afterEach(() => rm(workspace, { recursive: true, force: true }));

const post = async (body: Record<string, unknown>) => {
	const response = await POST(
		new Request('http://localhost:3000/api/applications', {
			method: 'POST',
			headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
			body: JSON.stringify({ workspace, ...body }),
		}),
	);
	return { status: response.status, body: await response.json() };
};
const row = { url: 'https://example.com/job', title: 'Frontend Engineer', company: 'Acme' };

test('add, update and delete manual rows with their error codes', async () => {
	const added = await post({ action: 'add', row });
	expect(added).toMatchObject({
		status: 200,
		body: { row: { origin: 'manual', status: 'new', title: 'Frontend Engineer' } },
	});
	const { fingerprint } = added.body.row;
	expect((await post({ action: 'add', row })).status).toBe(409);
	expect((await post({ action: 'add', row: { ...row, url: 'ftp://example.com' } })).status).toBe(400);

	const updated = await post({
		action: 'update',
		fingerprint,
		changes: { status: 'applied', expectedSalary: '25k' },
	});
	expect(updated.body.row).toMatchObject({ status: 'applied', expectedSalary: '25k' });
	expect((await post({ action: 'update', fingerprint, changes: { origin: 'search' } })).status).toBe(400);

	expect(await post({ action: 'delete', fingerprint })).toEqual({ status: 200, body: {} });
	expect((await post({ action: 'delete', fingerprint })).status).toBe(404);
	expect((await post({ action: 'update', fingerprint, changes: { status: 'offer' } })).status).toBe(404);
	expect((await post({ action: 'load' })).body.applications).toEqual([]);
});

test('saved preferences re-evaluate manual salary on read without rewriting originals or user inputs', async () => {
	const list = await ApplicationList.open(workspace);
	const original = {
		fingerprint: 'a'.repeat(64),
		addedAt: '2026-10-23T12:00:00Z',
		job: {
			sourceId: 'linkedin' as const,
			sourceJobId: '1',
			url: 'https://example.com/job',
			title: 'Engineer',
			company: null,
			locations: [],
			publishedAt: null,
			observedAt: '2026-10-23T12:00:00Z',
			availability: 'open' as const,
		},
		match: {
			outcome: 'needs-clarification' as const,
			costUsd: null,
			criteria: [
				{
					criterion: 'salary' as const,
					result: 'unknown' as const,
					evidence: 'structured' as const,
					detail: 'Employer pay unavailable',
				},
				{
					criterion: 'workArrangement' as const,
					result: 'unknown' as const,
					evidence: 'model' as const,
					detail: 'Arrangement unknown',
				},
			],
		},
	};
	await list.add(original);
	const salary = { amount: 25000, currency: 'PLN', period: 'month', contractType: 'B2B' };
	const update = await post({
		action: 'update',
		fingerprint: original.fingerprint,
		changes: { expectedSalary: salary, workArrangementOverride: ['remote', 'hybrid'] },
	});
	expect(update.status).toBe(200);
	expect(update.body.row.match).toEqual(original.match);
	expect(update.body.row.assessment).toBeUndefined();
	const file = join(workspace, 'applications', 'applications.json');
	const before = await readFile(file, 'utf8');
	const loaded = async () => {
		const result = await post({ action: 'load' });
		expect(result.status).toBe(200);
		return loadResultSchema.parse(result.body).applications;
	};
	let rows = await loaded();
	expect(rows[0]?.origin === 'search' && rows[0].assessment.match.outcome).toBe('needs-clarification');
	const repo = await PreferencesRepository.open(workspace);
	const preferences = searchPreferencesSchema.parse({
		targetPosition: {
			positionTitles: ['Engineer'],
			seniority: ['senior'],
			positionType: ['full-time'],
			workArrangements: ['remote'],
			salaryRange: [{ min: 20000, desired: 22000, currency: 'PLN', period: 'month', contractType: 'B2B' }],
		},
		settings: { maxJobsToProcess: 10, maxJobsToMatch: 5 },
	});
	let snapshot = await repo.publish(toDraft(preferences), (await repo.load()).revision);
	rows = await loaded();
	expect(rows[0]?.origin === 'search' && rows[0].assessment.match.outcome).toBe('match');
	const draft = toDraft(preferences);
	draft.targetPosition.salaryRange[0]!.min = '30000';
	draft.targetPosition.salaryRange[0]!.desired = '';
	snapshot = await repo.edit(draft, snapshot.revision);
	rows = await loaded();
	expect(rows[0]?.origin === 'search' && rows[0].assessment.match.outcome).toBe('match');
	await repo.publish(draft, snapshot.revision);
	rows = await loaded();
	expect(rows[0]?.origin === 'search' && rows[0].assessment.match.outcome).toBe('needs-clarification');
	expect(await readFile(file, 'utf8')).toBe(before);
	expect((await list.list())[0]).toMatchObject({
		match: original.match,
		job: original.job,
		expectedSalary: salary,
		workArrangementOverride: ['remote', 'hybrid'],
	});
	for (const changes of [
		{ match: original.match },
		{ assessment: {} },
		{ workArrangementOverride: [] },
		{ expectedSalary: { ...salary, amount: -1 } },
	])
		expect((await post({ action: 'update', fingerprint: original.fingerprint, changes })).status).toBe(400);
	await post({
		action: 'update',
		fingerprint: original.fingerprint,
		changes: { expectedSalary: null, workArrangementOverride: null },
	});
	rows = await loaded();
	expect(rows[0]?.origin === 'search' && rows[0].assessment.match).toEqual(original.match);
});

test('invalid published preferences surface an error rather than a guessed assessment', async () => {
	const repo = await PreferencesRepository.open(workspace);
	await repo.load();
	await Bun.write(join(workspace, 'search-preferences', 'config.yaml'), 'schemaVersion: 999');
	expect((await post({ action: 'load' })).status).toBe(400);
});

test('a broken recovery draft does not block loading applications', async () => {
	const repo = await PreferencesRepository.open(workspace);
	await repo.load();
	await Bun.write(join(workspace, 'search-preferences', 'draft.yaml'), 'schemaVersion: 999');
	expect((await post({ action: 'load' })).status).toBe(200);
});

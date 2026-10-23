import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './route';

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

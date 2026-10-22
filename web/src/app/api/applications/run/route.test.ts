import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchPreferencesSchema } from '@/modules/search/model/schema';
import { toDraft } from '@/modules/search/model/form-model';
import { PreferencesRepository } from '@/modules/search/server/persistence';
import { readEvents } from '@/modules/applications/client/api';
import { POST as load } from '../route';
import { POST } from './route';

let workspace: string;
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'applications-route-'));
	process.env.OPENROUTER_API_KEY = 'test-key';
});
afterEach(async () => {
	globalThis.fetch = originalFetch;
	if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
	else process.env.OPENROUTER_API_KEY = originalKey;
	await rm(workspace, { recursive: true, force: true });
});

const post = (handler: (request: Request) => Promise<Response>, body: unknown, origin = 'http://localhost:3000') =>
	handler(
		new Request('http://localhost:3000/api/applications/run', {
			method: 'POST',
			headers: {
				host: 'localhost:3000',
				origin,
				'content-type': 'application/json',
			},
			body: JSON.stringify(body),
		}),
	);
async function savePreferences(settings: Record<string, number> = {}) {
	const repo = await PreferencesRepository.open(workspace);
	const preferences = searchPreferencesSchema.parse({
		targetPosition: {
			positionTitles: ['Engineer'],
			seniority: ['senior'],
			positionType: ['full-time'],
			workArrangements: ['remote'],
			salaryRange: [],
		},
		settings: { maxJobsToProcess: 5, maxJobsToMatch: 2, ...settings },
	});
	await repo.publish(toDraft(preferences), (await repo.load()).revision);
}
// LinkedIn requests hang until the run aborts them.
function hangingSources() {
	const aborted: string[] = [];
	globalThis.fetch = ((_: string, init?: RequestInit) =>
		new Promise((_resolve, reject) =>
			init?.signal?.addEventListener('abort', () => {
				aborted.push('aborted');
				reject(init.signal!.reason);
			}),
		)) as typeof fetch;
	return aborted;
}

test('preflight rejects foreign origins, missing preferences, missing skills and missing credentials', async () => {
	expect((await post(POST, { workspace }, 'https://foreign.example')).status).toBe(403);
	expect((await post(POST, { workspace })).status).toBe(400);
	await savePreferences({ minSkillMatch: 50 });
	const skills = await post(POST, { workspace });
	expect(skills.status).toBe(400);
	expect((await skills.json()).error).toContain('Add skills to your profile');
	await savePreferences();
	delete process.env.OPENROUTER_API_KEY;
	expect((await post(POST, { workspace })).status).toBe(503);
});

test('an empty source streams valid events ending in done', async () => {
	await savePreferences();
	globalThis.fetch = (async () =>
		new Response('<div class="jobs-search-no-results">No results found</div>')) as unknown as typeof fetch;
	const response = await post(POST, { workspace });
	expect(response.headers.get('content-type')).toBe('application/x-ndjson');
	const events = [];
	for await (const event of readEvents(response.body!)) events.push(event);
	expect(events[0].type).toBe('started');
	expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'exhausted' });
});

test('one run per workspace; load works during a run; cancelling the stream aborts and releases the run', async () => {
	await savePreferences();
	const aborted = hangingSources();
	const first = await post(POST, { workspace });
	const reader = first.body!.getReader();
	expect(new TextDecoder().decode((await reader.read()).value)).toContain('"started"');

	expect((await post(POST, { workspace })).status).toBe(409);
	const listed = await post(load, { action: 'load', workspace });
	expect(await listed.json()).toEqual({
		applications: [],
		sources: [{ id: 'linkedin', name: 'LinkedIn', supportedFilters: ['location', 'publishedAfter'] }],
	});

	await reader.cancel();
	expect(aborted.length).toBeGreaterThan(0);
	let next: Response | undefined;
	for (let attempt = 0; attempt < 50 && next?.status !== 200; attempt++) {
		await next?.body?.cancel();
		next = await post(POST, { workspace });
	}
	expect(next?.status).toBe(200);
	await next?.body?.cancel();
}, 15000);

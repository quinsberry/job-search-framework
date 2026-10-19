import assert from 'node:assert/strict';
import { createSearchSourceRun } from '../search.service';
import {
	SearchSourceError,
	type SearchSourceAdapter,
	type SourceId,
	type SearchBatch,
	type JobRef,
} from '../../contracts';
const fixtureId = 'fixture' as SourceId; // The isolated test copy extends sourceIdSchema with this ID.
const job = (sourceId: SourceId, sourceJobId: string) => ({
	sourceId,
	sourceJobId,
	url: `https://example.com/${sourceJobId}`,
	title: 'Engineer',
	company: null,
	locations: [],
	publishedAt: null,
	observedAt: '2026-10-19T00:00:00Z',
});
function fake(id: SourceId, delay: number, fail = false): SearchSourceAdapter {
	let page = 0;
	return {
		descriptor: { id, name: id, supportedFilters: [] },
		async search({ limit }: { limit: number }) {
			await Bun.sleep(delay);
			page++;
			if (fail) throw new SearchSourceError('blocked', 'Fictional wall');
			return {
				jobs: Array.from({ length: Math.min(limit, id === 'linkedin' ? 2 : 1) }, (_, index) =>
					job(id, `${page}-${index}`),
				),
				nextCursor: page < 3 ? String(page) : null,
				filters: [],
			};
		},
		async getDetail(ref: JobRef) {
			return { ok: false, ref, error: { code: 'not-found', message: 'Missing' } };
		},
	};
}
async function collect(limit: number, delays: number[]) {
	const run = createSearchSourceRun(
		{ sourceIds: ['linkedin', fixtureId], query: { query: 'x' } },
		new AbortController().signal,
		[fake('linkedin', delays[0]), fake(fixtureId, delays[1])],
	);
	const batches: SearchBatch[] = [];
	for (let count = 0; count < 10; count++) {
		const batch = await run.next(limit);
		assert.ok(batch.jobs.length <= limit);
		batches.push(batch);
		if (batch.done) break;
	}
	assert.ok(batches.at(-1)!.done);
	run.dispose();
	return batches;
}
for (const limit of [1, 3, 5]) {
	const first = await collect(limit, [0, 3]);
	const reversed = await collect(limit, [3, 0]);
	assert.deepEqual(first, reversed);
	assert.deepEqual(
		first
			.flatMap((batch) => batch.jobs)
			.slice(0, 2)
			.map((item) => item.sourceId),
		['linkedin', fixtureId],
	);
	assert.equal(first.flatMap((batch) => batch.jobs).filter((item) => item.sourceJobId === '1-0').length, 2);
}
let failures = 0;
const failing = fake(fixtureId, 0, true);
const failingSearch = failing.search;
failing.search = async (...args: Parameters<SearchSourceAdapter['search']>) => {
	failures++;
	return failingSearch(...args);
};
const run = createSearchSourceRun(
	{ sourceIds: ['linkedin', fixtureId], query: { query: 'x' } },
	new AbortController().signal,
	[fake('linkedin', 0), failing],
);
let batch = await run.next(2);
assert.equal(batch.jobs.length, 1);
assert.equal(batch.sources[1].error?.code, 'blocked');
batch = await run.next(2);
assert.ok(batch.jobs.length);
assert.equal(failures, 1);
run.dispose();
const allFailed = createSearchSourceRun(
	{ sourceIds: ['linkedin', fixtureId], query: { query: 'x' } },
	new AbortController().signal,
	[fake('linkedin', 0, true), fake(fixtureId, 0, true)],
);
const failed = await allFailed.next(2);
assert.equal(failed.done, true);
assert.ok(failed.sources.every((source: { status: string }) => source.status === 'failed'));
allFailed.dispose();

const selected = createSearchSourceRun(
	{ sourceIds: ['linkedin'], query: { query: 'x' } },
	new AbortController().signal,
	[fake('linkedin', 0), fake(fixtureId, 0)],
);
await assert.rejects(
	() => selected.getDetail({ sourceId: fixtureId, sourceJobId: 'other', url: 'https://example.com/other' }),
	{ code: 'invalid-input' },
);
selected.dispose();
const wrongSource = fake('linkedin', 0);
wrongSource.search = async () => ({ jobs: [job(fixtureId, 'other')], nextCursor: null, filters: [] });
const invalid = createSearchSourceRun(
	{ sourceIds: ['linkedin'], query: { query: 'x' } },
	new AbortController().signal,
	[wrongSource],
);
assert.equal((await invalid.next(1)).sources[0].error?.code, 'invalid-response');
invalid.dispose();

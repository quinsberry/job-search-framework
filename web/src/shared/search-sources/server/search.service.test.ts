import { expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchRun, fetchJobDetail, listSearchSources, resolveJobUrl } from './search.service';
import { SearchSourceError, type JobSummary, type SearchSourceAdapter } from '../contracts';

const job: JobSummary = {
	sourceId: 'linkedin',
	sourceJobId: '123456',
	url: 'https://www.linkedin.com/jobs/view/123456',
	title: 'Engineer',
	company: null,
	locations: [],
	publishedAt: '2026-10-01',
	observedAt: '2026-10-19T00:00:00Z',
};
const ref = { sourceId: job.sourceId, sourceJobId: job.sourceJobId, url: job.url };
function adapter(search: SearchSourceAdapter['search']): SearchSourceAdapter {
	return {
		descriptor: { id: 'linkedin', name: 'Fake LinkedIn', supportedFilters: [] },
		search,
		async getDetail(ref) {
			return {
				ok: true,
				job: { ...job, ...ref, publishedAt: null, description: 'Actual content', availability: 'unknown' },
			};
		},
	};
}
const input = { sourceIds: ['linkedin' as const], query: { query: 'engineer' } };
const signal = () => new AbortController().signal;

test('registry metadata and facade inputs validate without acquisition', () => {
	expect(listSearchSources().map((item) => item.id)).toEqual(['linkedin']);
	let calls = 0;
	const fake = adapter(async () => {
		calls++;
		return { jobs: [], nextCursor: null, filters: [] };
	});
	expect(() => new SearchRun({ ...input, sourceIds: [] }, signal(), [fake])).toThrow();
	expect(() => new SearchRun(input, signal(), [])).toThrow();
	expect(() => new SearchRun(input, signal(), [fake, fake])).toThrow();
	expect(calls).toBe(0);
});

test('busy rejection, exact deduplication and non-progress failure are bounded', async () => {
	let finish!: (value: { jobs: JobSummary[]; nextCursor: string; filters: [] }) => void;
	let calls = 0;
	const fake = adapter(async () => {
		calls++;
		return calls === 1
			? new Promise((resolve) => {
					finish = resolve;
				})
			: { jobs: [job], nextCursor: 'next', filters: [] };
	});
	const run = new SearchRun(input, signal(), [fake]);
	await expect(run.next(0)).rejects.toMatchObject({ code: 'invalid-input' });
	const pending = run.next(1);
	await expect(run.next(1)).rejects.toMatchObject({ code: 'busy' });
	finish({ jobs: [job], nextCursor: 'next', filters: [] });
	expect((await pending).jobs).toEqual([job]);
	const detail = await run.getDetail(ref);
	expect(detail.ok && detail.job.publishedAt).toBe('2026-10-01');
	const repeated = await run.next(1);
	expect(repeated.done).toBe(true);
	expect(repeated.sources[0].error?.code).toBe('invalid-response');
	await run.next(1);
	expect(calls).toBe(2);
	run.dispose();
});

test('empty pages with advancing cursors and repeated IDs acquire only once per next call', async () => {
	let calls = 0;
	const run = new SearchRun(input, signal(), [
		adapter(async () => {
			calls++;
			return {
				jobs: calls === 2 || calls === 3 ? [job] : [],
				nextCursor: calls < 4 ? String(calls) : null,
				filters: [],
			};
		}),
	]);
	expect((await run.next(5)).done).toBe(false);
	expect(calls).toBe(1);
	expect((await run.next(5)).jobs).toHaveLength(1);
	expect((await run.next(5)).jobs).toHaveLength(0);
	expect(calls).toBe(3);
	expect((await run.next(5)).done).toBe(true);
	run.dispose();
});

test('over-limit, wrong-source and malformed adapter responses fail terminally', async () => {
	for (const page of [
		{ jobs: [job, job], nextCursor: null, filters: [] },
		{ jobs: [{ ...job, title: '' }], nextCursor: null, filters: [] },
		{ jobs: [], nextCursor: '', filters: [] },
	]) {
		const run = new SearchRun(input, signal(), [adapter(async () => page)]);
		const batch = await run.next(1);
		expect(batch.done).toBe(true);
		expect(batch.sources[0].error?.code).toBe('invalid-response');
		run.dispose();
	}
});

test('requested filters must have an explicit application report', async () => {
	const requested = { ...input, query: { query: 'engineer', location: 'Poland' } };
	const missing = new SearchRun(requested, signal(), [
		adapter(async () => ({ jobs: [], nextCursor: null, filters: [] })),
	]);
	expect((await missing.next(1)).sources[0].error?.code).toBe('invalid-response');
	missing.dispose();
	const unsupported = new SearchRun(requested, signal(), [
		adapter(async () => ({
			jobs: [],
			nextCursor: null,
			filters: [{ filter: 'location', application: 'unsupported', message: 'Location is not supported' }],
		})),
	]);
	const batch = await unsupported.next(1);
	expect(batch.sources[0].filters[0].application).toBe('unsupported');
	expect(batch.sources[0].status).toBe('exhausted');
	unsupported.dispose();
});

test('detail failure stays local and identity mismatch is rejected', async () => {
	const fake = adapter(async () => ({ jobs: [], nextCursor: null, filters: [] }));
	let calls = 0;
	fake.getDetail = async () => {
		if (++calls === 1) throw new SearchSourceError('network', 'failed');
		return { ok: true, job: { ...job, description: 'content', availability: 'unknown' } };
	};
	const run = new SearchRun(input, signal(), [fake]);
	const failed = await run.getDetail(ref);
	expect(!failed.ok && failed.error.code).toBe('network');
	expect((await run.getDetail(ref)).ok).toBe(true);
	const mismatch = await run.getDetail({ ...ref, sourceJobId: 'different' });
	expect(!mismatch.ok && mismatch.error.code).toBe('invalid-response');
	run.dispose();
});

test('cancellation/disposal reject pending and future operations even for an uncooperative adapter', async () => {
	for (const stop of ['cancel', 'dispose', 'timeout']) {
		const controller = new AbortController();
		const fake = adapter(async () => new Promise(() => {}));
		fake.getDetail = async () => new Promise(() => {});
		const run = new SearchRun(input, stop === 'timeout' ? AbortSignal.timeout(5) : controller.signal, [fake]);
		const pending = Promise.allSettled([run.next(1), run.getDetail(ref)]);
		if (stop === 'cancel') controller.abort();
		else if (stop === 'dispose') run.dispose();
		const code = stop === 'timeout' ? 'timeout' : 'cancelled';
		for (const outcome of await pending) {
			expect(outcome.status).toBe('rejected');
			if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code });
		}
		await expect(run.next(1)).rejects.toMatchObject({ code });
		await expect(run.getDetail(ref)).rejects.toMatchObject({ code });
		run.dispose();
	}
});

test('separate run instances keep identities, cursors and cancellation isolated', async () => {
	const controller = new AbortController();
	const cursors: (string | undefined)[] = [];
	const fake = adapter(async ({ cursor }) => {
		cursors.push(cursor);
		return { jobs: [job], nextCursor: cursor ? null : 'next', filters: [] };
	});
	const first = new SearchRun(input, controller.signal, [fake]);
	const second = new SearchRun(input, signal(), [fake]);
	expect((await first.next(1)).jobs).toHaveLength(1);
	expect((await second.next(1)).jobs).toHaveLength(1);
	controller.abort();
	await expect(first.next(1)).rejects.toMatchObject({ code: 'cancelled' });
	const remaining = await second.next(1);
	expect(remaining.done).toBe(true);
	expect(remaining.jobs).toHaveLength(0);
	expect(cursors).toEqual([undefined, undefined, 'next']);
	first.dispose();
	second.dispose();
});

// Extend only the enum in an isolated copy, exactly as adding a second production source would.
// Fictional IDs never become accepted production inputs or leak through Bun's global module mocks.
test('multiple adapters share the unmodified facade fairly and isolate failures', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'search-source-contract-'));
	try {
		await cp(new URL('../', import.meta.url), directory, { recursive: true });
		await symlink(
			new URL('../../../../node_modules', import.meta.url).pathname,
			join(directory, 'node_modules'),
			'dir',
		);
		const contracts = join(directory, 'contracts.ts');
		await writeFile(
			contracts,
			(await readFile(contracts, 'utf8')).replace("z.enum(['linkedin'])", "z.enum(['linkedin', 'fixture'])"),
		);
		const process = Bun.spawn(
			[Bun.which('bun')!, 'run', join(directory, 'server/fixtures/multi-source.fixture.ts')],
			{ stdout: 'pipe', stderr: 'pipe' },
		);
		const [code, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
		expect(stderr).toBe('');
		expect(code).toBe(0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('a vacancy URL resolves through the source that claims it and is fetched with run checks', async () => {
	const claiming = {
		...adapter(async () => ({ jobs: [], nextCursor: null, filters: [] })),
		referenceFromUrl: () => ref,
	};
	expect(resolveJobUrl('https://www.linkedin.com/jobs/view/123456')).toEqual(ref);
	expect(resolveJobUrl('https://jobs.example.com/123456')).toBeNull();
	expect(
		resolveJobUrl('https://jobs.example.com/123456', [
			adapter(async () => ({ jobs: [], nextCursor: null, filters: [] })),
		]),
	).toBeNull();
	expect(resolveJobUrl('anything', [claiming])).toEqual(ref);
	const result = await fetchJobDetail(ref, signal(), [claiming]);
	expect(result).toMatchObject({ ok: true, job: { sourceJobId: '123456', description: 'Actual content' } });
	const wrong = {
		...claiming,
		getDetail: async () => ({
			ok: true as const,
			job: {
				...job,
				sourceJobId: '999999',
				publishedAt: null,
				description: 'Other',
				availability: 'unknown' as const,
			},
		}),
	};
	expect(await fetchJobDetail(ref, signal(), [wrong])).toMatchObject({
		ok: false,
		error: { code: 'invalid-response' },
	});
	const foreign = {
		...claiming,
		referenceFromUrl: () => ({ ...ref, sourceId: 'other' }),
	} as unknown as SearchSourceAdapter;
	expect(() => resolveJobUrl('anything', [foreign])).toThrow('Invalid source input');
});

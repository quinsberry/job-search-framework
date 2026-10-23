import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	jobRefSchema,
	type DiscoveryQuery,
	type JobDetail,
	type SearchBatch,
	type SearchSourceRun,
	type SourceReport,
} from '@/shared/search-sources/contracts';
import type { SearchPreferences } from '@/modules/search/model/schema';
import type { MatchResult } from '@/modules/search/server/matching/match';
import { runEventSchema, type RunEvent } from '../model/contracts';
import { criteriaDigest, fingerprint } from './fingerprint';
import { ApplicationList } from './application-list';
import { SearchMemory } from './search-memory';
import { runSearch, type RunDeps } from './workflow';

let workspace: string;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), 'applications-'));
});
afterEach(() => rm(workspace, { recursive: true, force: true }));

const NOW = new Date('2026-10-22T12:00:00Z');
function job(id: string, overrides: Partial<JobDetail> = {}): JobDetail {
	return {
		sourceId: 'linkedin',
		sourceJobId: id,
		url: `https://www.linkedin.com/jobs/view/${id}`,
		title: `Engineer ${id}`,
		company: { name: `Company ${id}`, url: null },
		locations: [{ label: 'Warsaw, Poland', city: 'Warsaw', country: 'Poland' }],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		description: 'A job.',
		availability: 'open',
		...overrides,
	};
}
function preferences(settings: Partial<SearchPreferences['settings']> = {}, titles = ['Engineer']): SearchPreferences {
	return {
		targetPosition: {
			positionTitles: titles,
			seniority: ['senior'],
			positionType: ['full-time'],
			workArrangements: ['remote', 'hybrid'],
			location: { city: 'Warsaw', country: 'Poland' },
			salaryRange: [],
		},
		settings: { maxJobsToProcess: 10, maxJobsToMatch: 5, ...settings },
	};
}
const result = (outcome: MatchResult['outcome'], costUsd: number | null = 0.01): MatchResult => ({
	outcome,
	criteria: [
		{
			criterion: 'role',
			result: outcome === 'no-match' ? 'failed' : 'met',
			evidence: 'model',
			detail: 'role',
		},
	],
	costUsd,
});

type Fake = {
	jobs: JobDetail[];
	failure?: SourceReport['error'];
	detailFailures?: string[];
};
function harness(byQuery: Record<string, Fake>, outcomes: Record<string, MatchResult | Error> = {}) {
	const calls = {
		details: [] as string[],
		matches: [] as string[],
		pulls: [] as string[],
		disposed: 0,
	};
	const openRun = (query: DiscoveryQuery): SearchSourceRun => {
		const fake = byQuery[query.query];
		let offset = 0;
		return {
			async next(limit): Promise<SearchBatch> {
				calls.pulls.push(query.query);
				if (fake.failure)
					return {
						jobs: [],
						done: true,
						sources: [
							{
								sourceId: 'linkedin',
								status: 'failed',
								filters: [],
								error: fake.failure,
							},
						],
					};
				const jobs = fake.jobs.slice(offset, offset + limit).map((detail) => {
					const { description, ...summary } = detail;
					void description;
					return summary;
				});
				offset += jobs.length;
				const done = offset >= fake.jobs.length;
				return {
					jobs,
					done,
					sources: [
						{
							sourceId: 'linkedin',
							status: done ? 'exhausted' : 'active',
							filters: [],
							error: null,
						},
					],
				};
			},
			async getDetail(ref) {
				jobRefSchema.parse(ref); // SearchRun rejects anything but a strict reference.
				calls.details.push(ref.sourceJobId);
				if (fake.detailFailures?.includes(ref.sourceJobId))
					return {
						ok: false,
						ref,
						error: { code: 'network', message: 'down' },
					};
				return {
					ok: true,
					job: fake.jobs.find((item) => item.sourceJobId === ref.sourceJobId)!,
				};
			},
			dispose() {
				calls.disposed++;
			},
		};
	};
	const match = async (detail: JobDetail) => {
		calls.matches.push(detail.sourceJobId);
		const outcome = outcomes[detail.sourceJobId] ?? result('match');
		if (outcome instanceof Error) throw outcome;
		return outcome;
	};
	return { openRun, match, calls };
}
async function run(
	prefs: SearchPreferences,
	fake: ReturnType<typeof harness>,
	options: { signal?: AbortSignal; now?: Date; digest?: string } = {},
) {
	const list = await ApplicationList.open(workspace);
	const deps: RunDeps = {
		openRun: fake.openRun,
		match: fake.match,
		memory: await SearchMemory.open(workspace),
		list,
		now: () => options.now ?? NOW,
	};
	const events: RunEvent[] = [];
	for await (const event of runSearch(
		{
			preferences: prefs,
			criteriaDigest: options.digest ?? criteriaDigest(prefs, [], 1),
		},
		deps,
		options.signal ?? new AbortController().signal,
	))
		events.push(runEventSchema.parse(event));
	const done = events.at(-1)!;
	if (done.type !== 'done') throw new Error('Run did not finish with done');
	return { events, done, list };
}
const indexPath = () => join(workspace, 'search-runs', 'inspected.jsonl');
const reset = () =>
	Promise.all(
		['applications', 'search-runs'].map((name) => rm(join(workspace, name), { recursive: true, force: true })),
	);
const listed = async () =>
	(await (await ApplicationList.open(workspace)).list()).flatMap((row) => (row.origin === 'search' ? [row] : []));
const matchError = (code: string) => Object.assign(new Error(code), { name: 'MatchError', code });

test('fingerprint normalises company, title and place; falls back to source identity without a company', () => {
	const a = job('1', {
		company: { name: 'Acme GmbH', url: null },
		title: 'Senior Développeur',
	});
	const b = job('2', {
		company: { name: 'acme', url: null },
		title: 'senior developpeur!',
		locations: [{ label: 'x', city: 'WARSAW', country: null }],
	});
	expect(fingerprint(a)).toBe(fingerprint(b));
	expect(fingerprint(job('3', { title: 'Developpeur', company: { name: 'Acme', url: null } }))).not.toBe(
		fingerprint(a),
	);
	const countryOnly = job('4', {
		locations: [{ label: 'Poland', city: null, country: 'Poland' }],
	});
	const remote = job('4', { locations: [] });
	expect(fingerprint(countryOnly)).not.toBe(fingerprint(remote));
	expect(fingerprint(job('5', { company: null }))).not.toBe(
		fingerprint(job('6', { company: null, sourceJobId: '5x' })),
	);
	expect(fingerprint(job('5', { company: null }))).toBe(fingerprint(job('5', { company: null, title: 'Other' })));
});

test('criteria digest follows target position, skill threshold, skills and rules version, not budgets', () => {
	const base = criteriaDigest(preferences(), ['Node.js', 'SQL'], 1);
	expect(criteriaDigest(preferences({ maxJobsToProcess: 50 }), ['sql', 'nodejs'], 1)).toBe(base);
	expect(criteriaDigest(preferences({ minSkillMatch: 50 }), ['Node.js', 'SQL'], 1)).not.toBe(base);
	expect(criteriaDigest(preferences(), ['Node.js'], 1)).not.toBe(base);
	expect(criteriaDigest(preferences({}, ['Engineer', 'Developer']), ['Node.js', 'SQL'], 1)).not.toBe(base);
	expect(criteriaDigest(preferences(), ['Node.js', 'SQL'], 2)).not.toBe(base);
});

test('titles alternate and a vacancy found under both is processed once', async () => {
	const shared = job('shared');
	const fake = harness({
		A: { jobs: [shared, job('a2')] },
		B: { jobs: [{ ...shared, sourceJobId: 'other-id' }, job('b2')] },
	});
	const { done } = await run(preferences({ maxJobsToProcess: 10, maxJobsToMatch: 10 }, ['A', 'B']), fake);
	expect(fake.calls.pulls.slice(0, 2)).toEqual(['A', 'B']);
	expect(fake.calls.details.sort()).toEqual(['a2', 'b2', 'shared']);
	expect(done).toMatchObject({
		reason: 'exhausted',
		totals: { processed: 3, matched: 3, skipped: 1 },
	});
	expect(fake.calls.disposed).toBe(2);
});

test('budgets stop on matches (counting needs-clarification) and on processed vacancies', async () => {
	const jobs = ['1', '2', '3', '4'].map((id) => job(id));
	let fake = harness({ Engineer: { jobs } }, { '1': result('needs-clarification'), '2': result('no-match') });
	let outcome = await run(preferences({ maxJobsToProcess: 10, maxJobsToMatch: 2 }), fake);
	expect(outcome.done).toMatchObject({
		reason: 'match-budget',
		totals: { processed: 3, matched: 2 },
	});
	expect(fake.calls.matches).toEqual(['1', '2', '3']);

	await reset();
	fake = harness({ Engineer: { jobs } }, { '1': result('no-match'), '2': result('no-match') });
	outcome = await run(preferences({ maxJobsToProcess: 2, maxJobsToMatch: 2 }), fake);
	expect(outcome.done).toMatchObject({
		reason: 'process-budget',
		totals: { processed: 2, matched: 0 },
	});
});

test('closed vacancies are recorded without matching', async () => {
	const fake = harness({
		Engineer: { jobs: [job('1', { availability: 'closed' })] },
	});
	const { done } = await run(preferences(), fake);
	expect(fake.calls.matches).toEqual([]);
	expect(done.totals.processed).toBe(1);
	const index = await readFile(indexPath(), 'utf8');
	expect(index).toContain('"outcome":"closed"');
	expect(index).toContain('"failed":["availability"]');
});

test('reruns skip known vacancies without detail fetches and stop at the pull cap with no-new', async () => {
	const jobs = Array.from({ length: 30 }, (_, index) => job(String(index)));
	const outcomes = Object.fromEntries(
		jobs.map((item, index) => [item.sourceJobId, result(index % 2 ? 'no-match' : 'match')]),
	);
	await run(preferences({ maxJobsToProcess: 30, maxJobsToMatch: 30 }), harness({ Engineer: { jobs } }, outcomes));

	const fake = harness({ Engineer: { jobs } }, outcomes);
	const { done, events } = await run(preferences({ maxJobsToProcess: 30, maxJobsToMatch: 30 }), fake);
	expect(fake.calls.details).toEqual([]);
	expect(done).toMatchObject({
		reason: 'exhausted',
		totals: { processed: 0, skipped: 30 },
	});
	// Two pages of only known vacancies report progress once each.
	expect(events.filter((event) => event.type === 'progress')).toHaveLength(2);

	const many = Array.from({ length: 40 }, (_, index) => job(String(index)));
	const capped = harness({ Engineer: { jobs: many } }, outcomes);
	const second = await run(preferences({ maxJobsToProcess: 2, maxJobsToMatch: 2 }), capped);
	expect(second.done.reason).toBe('no-new');
	expect(second.done.totals.skipped).toBe(10);

	// Something new before the cap is still a process-budget stop.
	const mixed = harness({ Engineer: { jobs: [job('new'), ...many] } }, outcomes);
	const third = await run(preferences({ maxJobsToProcess: 2, maxJobsToMatch: 2 }), mixed);
	expect(third.done).toMatchObject({ reason: 'process-budget', totals: { processed: 1, skipped: 9 } });
});

test('changed criteria and age re-inspect rejections but never applications', async () => {
	const jobs = [job('kept'), job('rejected')];
	const outcomes = { rejected: result('no-match') };
	await run(preferences(), harness({ Engineer: { jobs } }, outcomes));

	let fake = harness({ Engineer: { jobs } }, outcomes);
	await run(preferences(), fake, { digest: 'f'.repeat(64) });
	expect(fake.calls.details).toEqual(['rejected']);

	fake = harness({ Engineer: { jobs } }, outcomes);
	await run(preferences(), fake, {
		digest: 'f'.repeat(64),
		now: new Date('2026-12-30T12:00:00Z'),
	});
	expect(fake.calls.details).toEqual(['rejected']);
	expect((await listed()).map((item) => item.job.sourceJobId)).toEqual(['kept']);
});

test('a truncated last index line is ignored and other corruption fails the run', async () => {
	await run(preferences(), harness({ Engineer: { jobs: [job('1')] } }, { '1': result('no-match') }));
	const path = indexPath();
	await writeFile(path, (await readFile(path, 'utf8')) + '{"fingerprint":"ab');
	const fake = harness({ Engineer: { jobs: [job('1')] } });
	await run(preferences(), fake);
	expect(fake.calls.details).toEqual([]);
	expect(await readFile(path, 'utf8')).not.toContain('"ab');

	await writeFile(path, 'garbage\n' + (await readFile(path, 'utf8')));
	const { done } = await run(preferences(), harness({ Engineer: { jobs: [job('1')] } }));
	expect(done.reason).toBe('failed');
});

test('failure policy: skip per-job failures, stop on fatal model failures, report failed sources', async () => {
	const jobs = [job('detail'), job('timeout'), job('ok')];
	let fake = harness(
		{
			Engineer: { jobs, detailFailures: ['detail'] },
			Broken: { jobs: [], failure: { code: 'blocked', message: 'no' } },
		},
		{ timeout: matchError('timeout') },
	);
	let outcome = await run(preferences({}, ['Engineer', 'Broken']), fake);
	expect(
		outcome.events
			.filter((event) => event.type === 'job-failed')
			.map((event) => event.type === 'job-failed' && event.code),
	).toEqual(['network', 'timeout']);
	expect(outcome.events.some((event) => event.type === 'source-failed')).toBe(true);
	expect(outcome.done).toMatchObject({
		reason: 'exhausted',
		totals: { processed: 3, matched: 1 },
		unpricedCalls: 1,
	});

	// Failed vacancies are not recorded, so the next run retries them.
	fake = harness({ Engineer: { jobs } });
	await run(preferences(), fake);
	expect(fake.calls.details).toEqual(['detail', 'timeout']);

	for (const code of ['unavailable', 'rate-limited']) {
		await reset();
		fake = harness({ Engineer: { jobs } }, { detail: matchError(code) });
		outcome = await run(preferences(), fake);
		expect(outcome.done).toMatchObject({ reason: 'failed', error: { code } });
		expect(fake.calls.matches).toEqual(['detail']);
	}
});

test('cost sums reported costs and counts only unpriced model calls', async () => {
	const structured: MatchResult = {
		outcome: 'no-match',
		criteria: [
			{
				criterion: 'availability',
				result: 'failed',
				evidence: 'structured',
				detail: 'closed',
			},
		],
		costUsd: null,
	};
	const fake = harness(
		{ Engineer: { jobs: [job('1'), job('2'), job('3')] } },
		{
			'1': result('match', 0.25),
			'2': structured,
			'3': result('no-match', null),
		},
	);
	const { done } = await run(preferences(), fake);
	expect(done.costUsd).toBe(0.25);
	const index = await readFile(indexPath(), 'utf8');
	expect(index).toContain('"failed":["availability"]');
	expect(index).toContain('"failed":["role"]');
	expect(done.unpricedCalls).toBe(1);
});

test('cancellation stops acquisition and matching and leaves files valid', async () => {
	const controller = new AbortController();
	const jobs = [job('1'), job('2'), job('3')];
	const fake = harness({ Engineer: { jobs } });
	const original = fake.match;
	fake.match = async (detail) => {
		const value = await original(detail);
		controller.abort();
		return value;
	};
	const { done, list } = await run(preferences(), fake, {
		signal: controller.signal,
	});
	expect(done.reason).toBe('cancelled');
	expect(fake.calls.matches).toEqual(['1']);
	expect(fake.calls.disposed).toBe(1);
	expect((await list.list()).length).toBe(1);
});

test('deleted rows stay gone, whoever added them, and manual rows are skipped', async () => {
	const jobs = [job('kept'), job('deleted'), job('manual'), job('manual-deleted')];
	const first = await run(preferences(), harness({ Engineer: { jobs: jobs.slice(0, 2) } }));
	await first.list.remove(fingerprint(jobs[1]));
	// A manual row with the same company, title and city as a vacancy the search would find.
	await first.list.addManual(
		{
			url: 'https://example.com/manual',
			title: 'Engineer manual',
			company: 'Company manual',
			location: 'Warsaw, Poland',
		},
		NOW,
	);
	const removed = await first.list.addManual(
		{
			url: 'https://example.com/gone',
			title: 'Engineer manual-deleted',
			company: 'Company manual-deleted',
			location: 'Warsaw',
		},
		NOW,
	);
	await first.list.remove(removed.fingerprint);

	const fake = harness({ Engineer: { jobs } });
	const { done } = await run(preferences(), fake, { digest: 'f'.repeat(64) });
	expect(fake.calls.details).toEqual([]);
	expect(done.totals).toMatchObject({ processed: 0, skipped: 4 });
	expect((await listed()).map((item) => item.job.sourceJobId)).toEqual(['kept']);
	const memory = await readFile(indexPath(), 'utf8');
	expect(memory.match(/"outcome":"accepted"/g)).toHaveLength(2);
});

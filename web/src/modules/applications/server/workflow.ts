import type { DiscoveryQuery, JobDetail, SearchSourceRun } from '@/shared/search-sources/contracts';
import type { SearchPreferences } from '@/modules/search/model/schema';
import type { MatchResult } from '@/modules/search/server/matching/match';
import type { DoneEvent, matchSchema, RunEvent } from '../model/contracts';
import type { z } from 'zod';
import { fingerprint } from './fingerprint';
import { discoveryQueries } from './queries';
import type { ApplicationStore } from './store';

export type RunDeps = {
	openRun(query: DiscoveryQuery, signal: AbortSignal): SearchSourceRun;
	match(detail: JobDetail, signal: AbortSignal): Promise<MatchResult>;
	store: Pick<ApplicationStore, 'prepare' | 'has' | 'reject' | 'add'>;
	now(): Date;
};
export type RunInput = {
	preferences: SearchPreferences;
	criteriaDigest: string;
};

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const inStep: Same<z.output<typeof matchSchema>['criteria'], MatchResult['criteria']> = true;
void inStep;

const PAGE = 25;
const PULL_FACTOR = 5;
// MatchError lives in Search; modules share no runtime code, so recognise it by shape.
const matchCode = (error: unknown) =>
	error instanceof Error && error.name === 'MatchError' && 'code' in error ? String(error.code) : null;
const fatalMatchCodes = new Set(['invalid-input', 'unavailable', 'rate-limited']);

export async function* runSearch(input: RunInput, deps: RunDeps, signal: AbortSignal): AsyncGenerator<RunEvent> {
	const { maxJobsToProcess, maxJobsToMatch } = input.preferences.settings;
	const totals = { processed: 0, matched: 0, skipped: 0 };
	let costUsd = 0;
	let unpricedCalls = 0;
	const done = (reason: DoneEvent['reason'], error?: DoneEvent['error']): DoneEvent => ({
		type: 'done',
		reason,
		totals: { ...totals },
		costUsd,
		unpricedCalls,
		...(error ? { error } : {}),
	});
	const progress = (): RunEvent => ({ type: 'progress', ...totals });
	yield {
		type: 'started',
		budgets: { process: maxJobsToProcess, match: maxJobsToMatch },
	};
	const runs: SearchSourceRun[] = [];
	try {
		await deps.store.prepare(input.criteriaDigest, deps.now());
		for (const query of discoveryQueries(input.preferences)) runs.push(deps.openRun(query, signal));
		const active = [...runs];
		const reported = new Set<string>();
		const seen = new Set<string>();
		let pulled = 0;
		let turn = 0;
		for (;;) {
			if (signal.aborted) return yield done('cancelled');
			if (totals.matched >= maxJobsToMatch) return yield done('match-budget');
			if (totals.processed >= maxJobsToProcess) return yield done('process-budget');
			// The pull cap with nothing processed means everything near the top of the results is already known.
			if (pulled >= PULL_FACTOR * maxJobsToProcess)
				return yield done(totals.processed ? 'process-budget' : 'no-new');
			if (!active.length) return yield done('exhausted');
			turn %= active.length;
			const run = active[turn];
			const batch = await run.next(Math.min(PAGE, maxJobsToProcess - totals.processed));
			for (const source of batch.sources) {
				const key = `${runs.indexOf(run)}:${source.sourceId}`;
				if (source.error && !reported.has(key)) {
					reported.add(key);
					yield {
						type: 'source-failed',
						sourceId: source.sourceId,
						error: source.error,
					};
				}
			}
			if (batch.done) active.splice(turn, 1);
			else turn++;
			const processedBefore = totals.processed;
			for (const job of batch.jobs) {
				if (signal.aborted) return yield done('cancelled');
				if (totals.processed >= maxJobsToProcess || totals.matched >= maxJobsToMatch) break;
				pulled++;
				const id = fingerprint(job);
				if (deps.store.has(id) || seen.has(id)) {
					totals.skipped++;
					continue;
				}
				seen.add(id);
				totals.processed++;
				const ref = {
					sourceId: job.sourceId,
					sourceJobId: job.sourceJobId,
					url: job.url,
				};
				const detail = await run.getDetail(ref);
				if (!detail.ok) {
					yield {
						type: 'job-failed',
						ref: detail.ref,
						code: detail.error.code,
					};
				} else if (detail.job.availability === 'closed') {
					await deps.store.reject(
						rejection(id, 'closed', ['availability'], detail.job, input.criteriaDigest, deps.now()),
					);
				} else {
					let result: MatchResult;
					try {
						result = await deps.match(detail.job, signal);
					} catch (error) {
						const code = matchCode(error);
						if (signal.aborted || code === 'cancelled') return yield done('cancelled');
						if (code === null || fatalMatchCodes.has(code)) throw error;
						unpricedCalls++;
						yield { type: 'job-failed', ref, code };
						yield progress();
						continue;
					}
					if (result.costUsd !== null) costUsd += result.costUsd;
					else if (result.criteria.some((item) => item.evidence === 'model')) unpricedCalls++;
					if (result.outcome === 'no-match') {
						await deps.store.reject(
							rejection(
								id,
								'no-match',
								result.criteria
									.filter((item) => item.result === 'failed')
									.map((item) => item.criterion),
								detail.job,
								input.criteriaDigest,
								deps.now(),
							),
						);
					} else {
						const { description, ...job } = detail.job;
						void description;
						const record = {
							fingerprint: id,
							job,
							match: { ...result, outcome: result.outcome },
							matchedAt: deps.now().toISOString(),
						};
						await deps.store.add(record);
						totals.matched++;
						yield { type: 'application', record };
					}
				}
				yield progress();
			}
			// Processed vacancies already reported progress; a batch of only known vacancies reports once.
			if (totals.processed === processedBefore && batch.jobs.length) yield progress();
		}
	} catch (error) {
		if (signal.aborted) return yield done('cancelled');
		const code = error instanceof Error && 'code' in error ? String(error.code) : 'unavailable';
		yield done('failed', {
			code,
			message: error instanceof Error ? error.message : 'Search run failed',
		});
	} finally {
		for (const run of runs) run.dispose();
	}
}

function rejection(
	fingerprint: string,
	outcome: 'no-match' | 'closed',
	failed: string[],
	job: JobDetail,
	criteriaDigest: string,
	now: Date,
) {
	return {
		fingerprint,
		outcome,
		failed,
		criteriaDigest,
		inspectedAt: now.toISOString(),
		ref: { sourceId: job.sourceId, sourceJobId: job.sourceJobId, url: job.url },
	};
}

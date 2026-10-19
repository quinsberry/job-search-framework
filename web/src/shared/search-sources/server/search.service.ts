import { z } from 'zod';
import {
	cancellationError,
	detailResultSchema,
	jobRefSchema,
	pageLimitSchema,
	SearchSourceError,
	sourceDescriptorSchema,
	sourceFailure,
	sourcePageSchema,
	sourceRunInputSchema,
	type DetailResult,
	type JobRef,
	type JobSummary,
	type SearchSourceAdapter,
	type SearchSourceRun,
	type SourceDescriptor,
	type SourceId,
	type SourceReport,
} from '../contracts';
import { linkedinProvider } from './linkedin/provider';

const providers = {
	linkedin: linkedinProvider,
} satisfies { [Id in SourceId]: SearchSourceAdapter & { descriptor: { id: Id } } };

function input<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw new SearchSourceError('invalid-input', 'Invalid source input');
	return result.data;
}

// Abort even if an injected adapter fails to observe its signal.
async function interruptible<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let abort: () => void = () => {};
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				abort = () => reject(cancellationError(signal));
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) abort();
			}),
		]);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}

export function listSearchSources(): SourceDescriptor[] {
	return Object.values(providers).map((adapter) => sourceDescriptorSchema.parse(adapter.descriptor));
}

export function createSearchSourceRun(
	value: z.infer<typeof sourceRunInputSchema>,
	callerSignal: AbortSignal,
	adapters: readonly SearchSourceAdapter[] = Object.values(providers),
): SearchSourceRun {
	const selected = input(sourceRunInputSchema, value);
	const registry = new Map(
		adapters.map((adapter) => [input(sourceDescriptorSchema, adapter.descriptor).id, adapter]),
	);
	if (registry.size !== adapters.length) throw new SearchSourceError('invalid-input', 'Duplicate source adapters');
	const states = selected.sourceIds.map((id) => {
		const adapter = registry.get(id);
		if (!adapter) throw new SearchSourceError('invalid-input', 'Selected source is not registered');
		return {
			adapter,
			cursor: undefined as string | undefined,
			exhausted: false,
			buffer: [] as JobSummary[],
			seen: new Map<string, JobSummary['publishedAt']>(),
			cursors: new Set<string>(),
			report: { sourceId: id, status: 'active', filters: [], error: null } as SourceReport,
		};
	});
	const controller = new AbortController();
	const signal = controller.signal;
	let turn = 0;
	let busy = false;
	function release() {
		for (const state of states) {
			state.buffer.length = 0;
			state.cursor = undefined;
			state.seen.clear();
			state.cursors.clear();
		}
		callerSignal.removeEventListener('abort', cancel);
	}
	function cancel() {
		controller.abort(callerSignal.reason);
		release();
	}
	if (callerSignal.aborted) cancel();
	else callerSignal.addEventListener('abort', cancel, { once: true });
	function check() {
		if (signal.aborted) throw cancellationError(signal);
	}
	return {
		async next(limit) {
			check();
			input(pageLimitSchema, limit);
			if (busy) throw new SearchSourceError('busy', 'Source run is already advancing');
			busy = true;
			try {
				const order = states.map((_, offset) => states[(turn + offset) % states.length]);
				const participating = order
					.filter((state) => state.buffer.length || (!state.exhausted && !state.report.error))
					.slice(0, limit);
				const pageLimit = Math.ceil(limit / Math.max(1, participating.length));
				// Sequential acquisition bounds concurrency to one; merge order never depends on network timing.
				for (const state of participating) {
					if (state.buffer.length || state.exhausted || state.report.error) continue;
					check();
					try {
						const raw = await interruptible(
							state.adapter.search(
								{
									query: structuredClone(selected.query),
									limit: pageLimit,
									...(state.cursor ? { cursor: state.cursor } : {}),
								},
								signal,
							),
							signal,
						);
						check();
						const parsed = sourcePageSchema.safeParse(raw);
						if (
							!parsed.success ||
							parsed.data.jobs.length > pageLimit ||
							parsed.data.jobs.some((job) => job.sourceId !== state.report.sourceId)
						)
							throw new SearchSourceError('invalid-response', 'Invalid source page');
						const page = parsed.data;
						const requested = ['location', 'workArrangements', 'publishedAfter'].filter(
							(filter) => filter in selected.query,
						);
						if (
							page.filters.length !== requested.length ||
							new Set(page.filters.map((report) => report.filter)).size !== page.filters.length ||
							page.filters.some((report) => !requested.includes(report.filter))
						)
							throw new SearchSourceError('invalid-response', 'Missing or unexpected filter reports');
						const fresh = page.jobs.filter((job) => {
							if (state.seen.has(job.sourceJobId)) return false;
							state.seen.set(job.sourceJobId, job.publishedAt);
							return true;
						});
						if (
							page.nextCursor &&
							(page.nextCursor === state.cursor || state.cursors.has(page.nextCursor)) &&
							!fresh.length
						)
							throw new SearchSourceError('invalid-response', 'Source cursor made no progress');
						if (page.nextCursor) state.cursors.add(page.nextCursor);
						state.buffer.push(...fresh);
						state.cursor = page.nextCursor ?? undefined;
						state.exhausted = page.nextCursor === null;
						state.report.filters = page.filters;
					} catch (error) {
						check();
						state.report.error = sourceFailure(error);
						state.report.status = 'failed';
					}
				}
				check();
				const jobs: JobSummary[] = [];
				while (jobs.length < limit && participating.some((state) => state.buffer.length)) {
					for (const state of participating) {
						if (jobs.length === limit) break;
						const job = state.buffer.shift();
						if (job) {
							jobs.push(job);
							turn = (states.indexOf(state) + 1) % states.length;
						}
					}
				}
				if (!jobs.length && participating.length)
					turn = (states.indexOf(participating.at(-1)!) + 1) % states.length;
				for (const state of states)
					if (!state.report.error)
						state.report.status = state.exhausted && !state.buffer.length ? 'exhausted' : 'active';
				return {
					jobs,
					done: states.every((state) => state.report.status !== 'active'),
					sources: states.map((state) => structuredClone(state.report)),
				};
			} finally {
				busy = false;
			}
		},
		async getDetail(value: JobRef): Promise<DetailResult> {
			check();
			const ref = input(jobRefSchema, value);
			const state = states.find((state) => state.report.sourceId === ref.sourceId);
			if (!state) throw new SearchSourceError('invalid-input', 'Reference source is outside this run');
			try {
				const raw = await interruptible(state.adapter.getDetail(ref, signal), signal);
				check();
				const result = detailResultSchema.safeParse(raw);
				if (!result.success) throw new SearchSourceError('invalid-response', 'Invalid source detail');
				const identity = result.data.ok ? result.data.job : result.data.ref;
				if (identity.sourceId !== ref.sourceId || identity.sourceJobId !== ref.sourceJobId)
					throw new SearchSourceError('invalid-response', 'Source returned a different job');
				if (result.data.ok && !result.data.job.publishedAt)
					result.data.job.publishedAt = state.seen.get(ref.sourceJobId) ?? null;
				return result.data;
			} catch (error) {
				check();
				return { ok: false, ref, error: sourceFailure(error) };
			}
		},
		dispose() {
			controller.abort();
			release();
		},
	};
}

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
	type DiscoveryQuery,
	type JobRef,
	type JobSummary,
	type SearchSourceAdapter,
	type SearchBatch,
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

type SourceState = {
	adapter: SearchSourceAdapter;
	cursor: string | undefined;
	exhausted: boolean;
	buffer: JobSummary[];
	seen: Map<string, JobSummary['publishedAt']>;
	cursors: Set<string>;
	report: SourceReport;
};

export class SearchRun implements SearchSourceRun {
	readonly #query: DiscoveryQuery;
	readonly #states: SourceState[];
	readonly #controller = new AbortController();
	readonly #signal = this.#controller.signal;
	readonly #callerSignal: AbortSignal;
	#turn = 0;
	#busy = false;

	constructor(
		value: z.infer<typeof sourceRunInputSchema>,
		callerSignal: AbortSignal,
		adapters: readonly SearchSourceAdapter[] = Object.values(providers),
	) {
		const selected = input(sourceRunInputSchema, value);
		const registry = new Map(
			adapters.map((adapter) => [input(sourceDescriptorSchema, adapter.descriptor).id, adapter]),
		);
		if (registry.size !== adapters.length)
			throw new SearchSourceError('invalid-input', 'Duplicate source adapters');
		this.#query = selected.query;
		this.#callerSignal = callerSignal;
		this.#states = selected.sourceIds.map((id): SourceState => {
			const adapter = registry.get(id);
			if (!adapter) throw new SearchSourceError('invalid-input', 'Selected source is not registered');
			return {
				adapter,
				cursor: undefined,
				exhausted: false,
				buffer: [],
				seen: new Map(),
				cursors: new Set(),
				report: { sourceId: id, status: 'active', filters: [], error: null },
			};
		});
		if (callerSignal.aborted) this.#cancel();
		else callerSignal.addEventListener('abort', this.#cancel, { once: true });
	}

	#release() {
		for (const state of this.#states) {
			state.buffer.length = 0;
			state.cursor = undefined;
			state.seen.clear();
			state.cursors.clear();
		}
		this.#callerSignal.removeEventListener('abort', this.#cancel);
	}

	#cancel = () => {
		this.#controller.abort(this.#callerSignal.reason);
		this.#release();
	};

	#check() {
		if (this.#signal.aborted) throw cancellationError(this.#signal);
	}

	async next(limit: number): Promise<SearchBatch> {
		this.#check();
		input(pageLimitSchema, limit);
		if (this.#busy) throw new SearchSourceError('busy', 'Source run is already advancing');
		this.#busy = true;
		try {
			const order = this.#states.map((_, offset) => this.#states[(this.#turn + offset) % this.#states.length]);
			const participating = order
				.filter((state) => state.buffer.length || (!state.exhausted && !state.report.error))
				.slice(0, limit);
			const pageLimit = Math.ceil(limit / Math.max(1, participating.length));
			// Sequential acquisition bounds concurrency to one; merge order never depends on network timing.
			for (const state of participating) {
				if (state.buffer.length || state.exhausted || state.report.error) continue;
				this.#check();
				try {
					const raw = await interruptible(
						state.adapter.search(
							{
								query: structuredClone(this.#query),
								limit: pageLimit,
								...(state.cursor ? { cursor: state.cursor } : {}),
							},
							this.#signal,
						),
						this.#signal,
					);
					this.#check();
					const parsed = sourcePageSchema.safeParse(raw);
					if (
						!parsed.success ||
						parsed.data.jobs.length > pageLimit ||
						parsed.data.jobs.some((job) => job.sourceId !== state.report.sourceId)
					)
						throw new SearchSourceError('invalid-response', 'Invalid source page');
					const page = parsed.data;
					const requested = ['location', 'workArrangements', 'publishedAfter'].filter(
						(filter) => filter in this.#query,
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
					this.#check();
					state.report.error = sourceFailure(error);
					state.report.status = 'failed';
				}
			}
			this.#check();
			const jobs: JobSummary[] = [];
			while (jobs.length < limit && participating.some((state) => state.buffer.length)) {
				for (const state of participating) {
					if (jobs.length === limit) break;
					const job = state.buffer.shift();
					if (job) {
						jobs.push(job);
						this.#turn = (this.#states.indexOf(state) + 1) % this.#states.length;
					}
				}
			}
			if (!jobs.length && participating.length)
				this.#turn = (this.#states.indexOf(participating.at(-1)!) + 1) % this.#states.length;
			for (const state of this.#states)
				if (!state.report.error)
					state.report.status = state.exhausted && !state.buffer.length ? 'exhausted' : 'active';
			return {
				jobs,
				done: this.#states.every((state) => state.report.status !== 'active'),
				sources: this.#states.map((state) => structuredClone(state.report)),
			};
		} finally {
			this.#busy = false;
		}
	}

	async getDetail(value: JobRef): Promise<DetailResult> {
		this.#check();
		const ref = input(jobRefSchema, value);
		const state = this.#states.find((state) => state.report.sourceId === ref.sourceId);
		if (!state) throw new SearchSourceError('invalid-input', 'Reference source is outside this run');
		try {
			const raw = await interruptible(state.adapter.getDetail(ref, this.#signal), this.#signal);
			this.#check();
			const result = detailResultSchema.safeParse(raw);
			if (!result.success) throw new SearchSourceError('invalid-response', 'Invalid source detail');
			const identity = result.data.ok ? result.data.job : result.data.ref;
			if (identity.sourceId !== ref.sourceId || identity.sourceJobId !== ref.sourceJobId)
				throw new SearchSourceError('invalid-response', 'Source returned a different job');
			if (result.data.ok && !result.data.job.publishedAt)
				result.data.job.publishedAt = state.seen.get(ref.sourceJobId) ?? null;
			return result.data;
		} catch (error) {
			this.#check();
			return { ok: false, ref, error: sourceFailure(error) };
		}
	}

	dispose() {
		this.#controller.abort();
		this.#release();
	}
}

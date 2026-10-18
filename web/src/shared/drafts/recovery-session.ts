export type RecoveryStatus = 'clean' | 'pending' | 'writing' | 'failed' | 'conflicted';
export type RecoveryState<B> = { status: RecoveryStatus; error: string; baseline: B };
export type SessionHandle = { prepareToLeave: () => Promise<void>; dispose: () => void };
export type Scheduler = { schedule(callback: () => void): unknown; cancel(handle: unknown): void };
export type Ticket<K extends string> = { session: string; id: number; generation: number; kind: K };
const scheduler: Scheduler = {
	schedule: (callback) => setTimeout(callback, 600),
	cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Serializes durability and commands; callers never manage write revisions or timers. */
export function createDraftSession<
	D,
	B,
	S extends { revision: string },
	K extends string = 'publish' | 'discard' | 'reload',
>(options: {
	id: string;
	initial: S;
	baseline: (snapshot: S) => B;
	draft: (snapshot: S) => D;
	write: (draft: D, revision: string) => Promise<S>;
	scheduler?: Scheduler;
}) {
	const clock = options.scheduler ?? scheduler;
	let cursor = options.initial.revision;
	let generation = 0;
	let acknowledged = 0;
	let latest: D | null = null;
	let timer: unknown;
	let disposed = false;
	let tail: Promise<unknown> = Promise.resolve();
	let commandId = 0;
	let acceptedCommand = 0;
	let replacing = 0;
	let running = 0;
	let observed: S | undefined;
	const acknowledgedSnapshots = new WeakSet<S>([options.initial]);
	let state: RecoveryState<B> = { status: 'clean', error: '', baseline: options.baseline(options.initial) };
	const listeners = new Set<() => void>();
	const emit = (patch: Partial<RecoveryState<B>>) => {
		const next = { ...state, ...patch };
		if (next.status !== state.status || next.error !== state.error || next.baseline !== state.baseline) {
			state = next;
			listeners.forEach((listener) => listener());
		}
	};
	const pending = () => generation > acknowledged;
	const cancelTimer = () => {
		if (timer !== undefined) clock.cancel(timer);
		timer = undefined;
	};
	const fail = (error: unknown) =>
		emit({
			status: error instanceof Error && 'code' in error && error.code === 'conflict' ? 'conflicted' : 'failed',
			error: error instanceof Error ? error.message : 'Draft recovery failed.',
		});
	function observe(snapshot: S) {
		if (disposed) return;
		if (running) {
			observed = snapshot;
			return;
		}
		if (snapshot.revision !== cursor && !acknowledgedSnapshots.has(snapshot))
			emit({
				status: 'conflicted',
				error: 'Data changed in another tab or on disk. Your edits are retained; reload to review current data.',
			});
	}
	function advance(snapshot: S) {
		cursor = snapshot.revision;
		acknowledgedSnapshots.add(snapshot);
	}
	const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
		const operation = tail
			.catch(() => {})
			.then(async () => {
				if (disposed) throw new Error('Editing session has ended.');
				running++;
				try {
					return await work();
				} finally {
					running--;
					if (!running && observed !== undefined) {
						const snapshot = observed;
						observed = undefined;
						observe(snapshot);
					}
				}
			});
		tail = operation;
		return operation;
	};
	async function drain() {
		cancelTimer();
		if (state.status === 'conflicted' || state.status === 'failed') throw new Error(state.error);
		while (pending() && latest !== null && !replacing) {
			const submitted = generation;
			const draft = structuredClone(latest);
			emit({ status: 'writing' });
			try {
				const snapshot = await options.write(draft, cursor);
				if (disposed) return;
				advance(snapshot);
				acknowledged = submitted;
				emit({ status: pending() ? 'pending' : 'clean', error: '' });
			} catch (error) {
				if (!disposed) fail(error);
				throw error;
			}
		}
	}
	const flush = () => enqueue(drain);
	function schedule() {
		cancelTimer();
		if (replacing) return;
		timer = clock.schedule(() => {
			timer = undefined;
			void flush().catch(() => {});
		});
	}
	function accept(snapshot: S, submitted: number, replace: boolean, updateBaseline: boolean): D | null {
		if (disposed) return null;
		if (replace && generation !== submitted) {
			emit({
				status: 'conflicted',
				error: 'Newer edits were retained. Reload explicitly to review the completed operation.',
			});
			return null;
		}
		advance(snapshot);
		if (updateBaseline) {
			acknowledged = submitted;
			emit({ baseline: options.baseline(snapshot), error: '', status: pending() ? 'pending' : 'clean' });
		}
		if (!replace) return null;
		latest = null;
		return options.draft(snapshot);
	}
	function reconcile(event: { ticket: Ticket<K>; snapshot: S }) {
		const { ticket, snapshot } = event;
		if (ticket.session !== options.id || ticket.id !== commandId || ticket.id <= acceptedCommand) return null;
		acceptedCommand = ticket.id;
		const replace = ticket.kind === 'discard' || ticket.kind === 'reload';
		return accept(snapshot, ticket.generation, replace, replace || ticket.kind === 'publish');
	}
	return {
		getState: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		change(draft: D) {
			if (disposed) return;
			latest = structuredClone(draft);
			generation++;
			if (state.status !== 'failed' && state.status !== 'conflicted') {
				emit({ status: 'pending' });
				schedule();
			}
		},
		flush,
		retry() {
			if (state.status === 'conflicted') return Promise.reject(new Error(state.error));
			emit({ status: pending() ? 'pending' : 'clean', error: '' });
			return flush();
		},
		observe,
		accept,
		reconcile,
		command(kind: K, operation: (revision: string, ticket: Ticket<K>) => Promise<S>) {
			cancelTimer();
			const replace = kind === 'discard' || kind === 'reload';
			const requestedGeneration = generation;
			if (replace) replacing++;
			return enqueue(async () => {
				try {
					if (!replace) await drain();
					const ticket: Ticket<K> = {
						session: options.id,
						id: ++commandId,
						generation: replace ? requestedGeneration : generation,
						kind,
					};
					const snapshot = await operation(cursor, ticket);
					return { snapshot, replacement: reconcile({ ticket, snapshot }) };
				} catch (error) {
					if (!disposed) fail(error);
					throw error;
				} finally {
					if (replace) replacing--;
					if (pending() && state.status !== 'conflicted' && state.status !== 'failed') schedule();
				}
			});
		},
		hasPending: pending,
		activate() {
			disposed = false;
			if (pending() && state.status === 'pending') schedule();
		},
		dispose() {
			disposed = true;
			cancelTimer();
		},
	};
}

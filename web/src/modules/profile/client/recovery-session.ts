import { emptyProfile, toDraft, type CandidateProfile, type ProfileDraft } from '../model/schema';
import { processing, type ProfileSnapshot, type RecordIds } from '../model/contracts';

export type DraftData = { values: ProfileDraft; recordIds: RecordIds };
export type RecoveryStatus = 'clean' | 'pending' | 'writing' | 'failed' | 'conflicted';
export type RecoveryState = {
	status: RecoveryStatus;
	error: string;
	baseline: CandidateProfile | null;
};
export type CommandKind = 'publish' | 'discard' | 'start' | 'retry' | 'reload';
export type Ticket = { session: string; id: number; generation: number; kind: CommandKind };
export type Reconciliation =
	| { ticket: Ticket; snapshot: ProfileSnapshot }
	| { session: string; jobId: string; snapshot: ProfileSnapshot };
type Scheduler = { schedule(callback: () => void): unknown; cancel(handle: unknown): void };
const scheduler: Scheduler = {
	schedule: (callback) => setTimeout(callback, 600),
	cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Owns durability and command ordering, independently of React, HTTP and form controls. */
export function createRecoverySession(options: {
	id: string;
	initial: ProfileSnapshot;
	write: (draft: DraftData, revision: string) => Promise<ProfileSnapshot>;
	scheduler?: Scheduler;
}) {
	const clock = options.scheduler ?? scheduler;
	let cursor = options.initial.revision;
	let generation = 0;
	let acknowledged = 0;
	let latest: DraftData | null = null;
	let timer: unknown;
	let disposed = false;
	let tail: Promise<unknown> = Promise.resolve();
	let commandId = 0;
	let acceptedCommand = 0;
	let trackedJob =
		processing(options.initial.job) && options.initial.job ? { id: options.initial.job.id, generation } : null;
	let state: RecoveryState = {
		status: 'clean',
		error: '',
		baseline: options.initial.profile,
	};
	const listeners = new Set<() => void>();
	const emit = (patch: Partial<RecoveryState>) => {
		const next = { ...state, ...patch };
		if (Object.keys(next).some((key) => next[key as keyof RecoveryState] !== state[key as keyof RecoveryState])) {
			state = next;
			listeners.forEach((listener) => listener());
		}
	};
	const pending = () => generation > acknowledged;
	const cancelTimer = () => {
		if (timer !== undefined) clock.cancel(timer);
		timer = undefined;
	};
	const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
		const operation = tail
			.catch(() => {})
			.then(() => {
				if (disposed) throw new Error('Editing session has ended.');
				return work();
			});
		tail = operation;
		return operation;
	};
	const fail = (error: unknown) =>
		emit({
			status: error instanceof Error && 'code' in error && error.code === 'conflict' ? 'conflicted' : 'failed',
			error: error instanceof Error ? error.message : 'Draft recovery failed.',
		});
	async function drain() {
		cancelTimer();
		if (state.status === 'conflicted' || state.status === 'failed') throw new Error(state.error);
		while (pending() && latest) {
			const submitted = generation;
			const draft = structuredClone(latest);
			emit({ status: 'writing' });
			try {
				const snapshot = await options.write(draft, cursor);
				if (disposed) return;
				cursor = snapshot.revision;
				acknowledged = submitted;
				emit({ status: pending() ? 'pending' : 'clean', error: '' });
			} catch (error) {
				if (!disposed) fail(error);
				throw error;
			}
		}
	}
	function flush() {
		return enqueue(drain);
	}
	function schedule() {
		cancelTimer();
		timer = clock.schedule(() => {
			timer = undefined;
			void flush().catch(() => {});
		});
	}
	function reconcile(event: Reconciliation): DraftData | null {
		if (disposed) return null;
		const snapshot = event.snapshot;
		let submitted: number;
		let kind: CommandKind | 'conversion';
		if ('ticket' in event) {
			const ticket = event.ticket;
			if (ticket.session !== options.id || ticket.id !== commandId || ticket.id <= acceptedCommand) return null;
			acceptedCommand = ticket.id;
			submitted = ticket.generation;
			kind = ticket.kind;
		} else {
			if (
				event.session !== options.id ||
				!trackedJob ||
				trackedJob.id !== event.jobId ||
				snapshot.job?.id !== event.jobId ||
				processing(snapshot.job)
			)
				return null;
			submitted = trackedJob.generation;
			kind = 'conversion';
			trackedJob = null;
		}
		const replacing =
			kind === 'discard' || kind === 'reload' || (kind === 'conversion' && snapshot.job?.phase === 'ready');
		if (replacing && generation !== submitted) {
			emit({
				status: 'conflicted',
				error: 'Newer edits were retained. Reload explicitly to review the completed operation.',
			});
			return null;
		}
		cursor = snapshot.revision;
		if (kind === 'start' || kind === 'retry' || kind === 'reload') {
			trackedJob =
				processing(snapshot.job) && snapshot.job ? { id: snapshot.job.id, generation: submitted } : null;
		}
		if (kind === 'publish' || replacing) {
			acknowledged = submitted;
			emit({
				baseline: snapshot.profile,
				error: '',
				status: pending() ? 'pending' : 'clean',
			});
		}
		if (!replacing) return null;
		latest = null;
		return {
			values: toDraft(snapshot.draft?.values ?? snapshot.profile ?? emptyProfile),
			recordIds: snapshot.draft?.recordIds ?? snapshot.recordIds,
		};
	}
	return {
		getState: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		change(draft: DraftData) {
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
		reconcile,
		command(kind: CommandKind, operation: (revision: string, ticket: Ticket) => Promise<ProfileSnapshot>) {
			cancelTimer();
			return enqueue(async () => {
				if (kind !== 'reload') await drain();
				const ticket: Ticket = { session: options.id, id: ++commandId, generation, kind };
				try {
					const snapshot = await operation(cursor, ticket);
					const replacement = reconcile({ ticket, snapshot });
					if (pending() && state.status !== 'conflicted') schedule();
					return { snapshot, replacement };
				} catch (error) {
					if (!disposed && error instanceof Error && 'code' in error && error.code === 'conflict')
						fail(error);
					throw error;
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
export type RecoverySession = ReturnType<typeof createRecoverySession>;

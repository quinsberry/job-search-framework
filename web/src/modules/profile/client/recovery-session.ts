import { createDraftSession, type Scheduler, type Ticket as DraftTicket } from '@/shared/drafts/recovery-session';
import { emptyProfile, toDraft, type ProfileDraft } from '../model/schema';
import { processing, type ProfileSnapshot, type RecordIds } from '../model/contracts';
export type { RecoveryStatus } from '@/shared/drafts/recovery-session';
export type DraftData = { values: ProfileDraft; recordIds: RecordIds };
export type CommandKind = 'publish' | 'discard' | 'start' | 'retry' | 'reload';
export type Ticket = DraftTicket<CommandKind>;
export type Reconciliation =
	| { ticket: Ticket; snapshot: ProfileSnapshot }
	| { session: string; jobId: string; snapshot: ProfileSnapshot };

export function createRecoverySession(options: {
	id: string;
	initial: ProfileSnapshot;
	write: (draft: DraftData, revision: string) => Promise<ProfileSnapshot>;
	scheduler?: Scheduler;
}) {
	const core = createDraftSession<DraftData, ProfileSnapshot['profile'], ProfileSnapshot, CommandKind>({
		...options,
		baseline: (snapshot) => snapshot.profile,
		draft: (snapshot) => ({
			values: toDraft(snapshot.draft?.values ?? snapshot.profile ?? emptyProfile),
			recordIds: snapshot.draft?.recordIds ?? snapshot.recordIds,
		}),
	});
	let trackedJob =
		processing(options.initial.job) && options.initial.job ? { id: options.initial.job.id, generation: 0 } : null;
	function track(snapshot: ProfileSnapshot, generation: number) {
		trackedJob = processing(snapshot.job) && snapshot.job ? { id: snapshot.job.id, generation } : null;
	}
	function reconcile(event: Reconciliation): DraftData | null {
		if ('ticket' in event) return core.reconcile(event);
		if (
			event.session !== options.id ||
			!trackedJob ||
			trackedJob.id !== event.jobId ||
			event.snapshot.job?.id !== event.jobId ||
			processing(event.snapshot.job)
		)
			return null;
		const submitted = trackedJob.generation;
		trackedJob = null;
		const replace = event.snapshot.job.phase === 'ready';
		return core.accept(event.snapshot, submitted, replace, replace);
	}
	return {
		...core,
		reconcile,
		observe(snapshot: ProfileSnapshot) {
			if (!trackedJob) core.observe(snapshot);
		},
		async command(kind: CommandKind, operation: (revision: string, ticket: Ticket) => Promise<ProfileSnapshot>) {
			const result = await core.command(kind, async (revision, ticket) => {
				const snapshot = await operation(revision, ticket);
				if (kind === 'start' || kind === 'retry' || kind === 'reload') track(snapshot, ticket.generation);
				return snapshot;
			});
			return result;
		},
	};
}
export type RecoverySession = ReturnType<typeof createRecoverySession>;

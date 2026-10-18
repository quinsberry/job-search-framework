'use client';
import type { Provider } from '@/shared/ai/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseFormReturn } from 'react-hook-form';
import type { FormValues } from '../model/form-model';
import { fromFormValues, toFormValues } from '../model/form-model';
import { processing, type ProfileSnapshot } from '../model/contracts';
import { createRecoverySession, type DraftData, type CommandKind } from './recovery-session';
import { commitProfile } from './queries';
import * as api from './api';
import { toast } from '@/shared/components/ui/toast';
import type { SessionHandle } from '@/shared/drafts/recovery-session';

export type ProfileHandle = SessionHandle;
export type ProfileFormApi = UseFormReturn<FormValues>;
type Intent = { kind: Exclude<CommandKind, 'start'> } | { kind: 'start'; file: File };
export function useProfileSession({
	workspace,
	sessionId,
	initial,
	snapshot,
	form,
	provider,
	onSession,
	onConverted,
}: {
	workspace: string;
	sessionId: string;
	initial: ProfileSnapshot;
	snapshot: ProfileSnapshot;
	form: ProfileFormApi;
	provider: Provider;
	onSession: (handle: ProfileHandle | null) => void;
	onConverted?: () => void;
}) {
	const client = useQueryClient();
	const { getValues, reset, subscribe } = form;
	const resetting = useRef(false);
	const [session] = useState(() =>
		createRecoverySession({
			id: sessionId,
			initial,
			write: (data, revision) =>
				commitProfile(client, workspace, sessionId, () => api.persistDraft({ workspace, revision, ...data })),
		}),
	);
	const replace = useCallback(
		(replacement: DraftData) => {
			resetting.current = true;
			reset(toFormValues(replacement.values, replacement.recordIds));
			resetting.current = false;
		},
		[reset],
	);

	// Connect RHF and the browser lifecycle to the independent durability session.
	useEffect(() => {
		session.activate();
		onSession({ prepareToLeave: session.flush, dispose: session.dispose });
		const unsubscribe = subscribe({
			formState: { values: true },
			callback: () => {
				if (!resetting.current) session.change(fromFormValues(getValues()));
			},
		});
		const unload = (event: BeforeUnloadEvent) => {
			if (session.hasPending()) {
				event.preventDefault();
				event.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', unload);
		return () => {
			unsubscribe();
			onSession(null);
			session.dispose();
			window.removeEventListener('beforeunload', unload);
		};
	}, [getValues, onSession, session, subscribe]);

	// Only a tracked terminal job can hand a query observation to the session.
	useEffect(() => {
		if (!snapshot.job || processing(snapshot.job)) return;
		const replacement = session.reconcile({ session: sessionId, jobId: snapshot.job.id, snapshot });
		if (replacement) {
			replace(replacement);
			onConverted?.();
			toast.add({
				type: 'success',
				title: 'CV converted',
				description: 'Expand the profile fields to review and save.',
			});
		}
	}, [snapshot, session, sessionId, replace, onConverted]);

	const mutation = useMutation({
		mutationKey: ['profile-intent', workspace, sessionId],
		networkMode: 'always',
		retry: false,
		mutationFn: async (intent: Intent) => {
			const result = await session.command(intent.kind, (revision) =>
				commitProfile(client, workspace, sessionId, () => {
					switch (intent.kind) {
						case 'publish':
							return api.publish({ workspace, revision, ...fromFormValues(getValues()) });
						case 'discard':
							return api.discard(workspace, revision);
						case 'start':
							return api.startImport(workspace, revision, intent.file, provider);
						case 'retry':
							return api.retryImport(workspace, revision, provider);
						case 'reload':
							return api.readSnapshot(workspace);
					}
				}),
			);
			if (result.replacement) replace(result.replacement);
			if (intent.kind === 'publish' || intent.kind === 'discard')
				toast.add({
					type: 'success',
					title: intent.kind === 'publish' ? 'Candidate profile saved' : 'Draft discarded',
				});
		},
		onError: (error) => toast.add({ type: 'error', title: 'Profile operation failed', description: error.message }),
	});
	return { session, act: mutation.mutate, busy: mutation.isPending, error: mutation.error?.message };
}

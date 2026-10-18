'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseFormReturn } from 'react-hook-form';
import { createDraftSession, type SessionHandle } from '@/shared/drafts/recovery-session';
import { toast } from '@/shared/components/ui/toast';
import type { PreferencesSnapshot } from '../model/contracts';
import type { PreferencesDraft } from '../model/schema';
import { toDraft } from '../model/form-model';
import { commitPreferences, preferencesOptions } from './queries';
import * as api from './api';

export function usePreferencesSession({
	workspace,
	sessionId,
	initial,
	snapshot,
	form,
	onSession,
}: {
	workspace: string;
	sessionId: string;
	initial: PreferencesSnapshot;
	snapshot: PreferencesSnapshot;
	form: UseFormReturn<PreferencesDraft>;
	onSession: (handle: SessionHandle | null) => void;
}) {
	const client = useQueryClient();
	const { getValues, reset, subscribe } = form;
	const resetting = useRef(false);
	const [session] = useState(() =>
		createDraftSession({
			id: sessionId,
			initial,
			baseline: (snapshot) => snapshot.preferences,
			draft: (snapshot) => snapshot.draft?.values ?? toDraft(snapshot.preferences),
			write: (values: PreferencesDraft, revision) =>
				commitPreferences(client, workspace, sessionId, () =>
					api.persistDraft({ workspace, revision, values }),
				),
		}),
	);
	// Synchronize form edits and browser lifecycle with the durability session.
	useEffect(() => {
		session.activate();
		onSession({ prepareToLeave: session.flush, dispose: session.dispose });
		const unsubscribe = subscribe({
			formState: { values: true },
			callback: () => {
				if (!resetting.current) session.change(getValues());
			},
		});
		const unload = (event: BeforeUnloadEvent) => {
			if (session.hasPending()) {
				event.preventDefault();
				event.returnValue = '';
			}
		};
		const focus = () => {
			void client.refetchQueries({ queryKey: preferencesOptions(workspace, sessionId).queryKey, type: 'active' });
		};
		window.addEventListener('beforeunload', unload);
		window.addEventListener('focus', focus);
		return () => {
			unsubscribe();
			onSession(null);
			session.dispose();
			window.removeEventListener('beforeunload', unload);
			window.removeEventListener('focus', focus);
		};
	}, [client, getValues, onSession, session, sessionId, subscribe, workspace]);
	// Observations can expose conflicts but cannot replace form values or the write cursor.
	useEffect(() => {
		session.observe(snapshot);
	}, [session, snapshot]);
	const mutation = useMutation({
		mutationKey: ['preferences-intent', workspace, sessionId],
		networkMode: 'always',
		retry: false,
		mutationFn: async (kind: 'publish' | 'discard' | 'reload') => {
			const result = await session.command(kind, (revision) =>
				commitPreferences(client, workspace, sessionId, () => {
					if (kind === 'publish') return api.publish({ workspace, revision, values: getValues() });
					if (kind === 'discard') return api.discard(workspace, revision);
					return api.readSnapshot(workspace);
				}),
			);
			if (result.replacement) {
				resetting.current = true;
				reset(result.replacement);
				resetting.current = false;
			}
			toast.add({
				type: 'success',
				title:
					kind === 'publish'
						? 'Search preferences saved'
						: kind === 'discard'
							? 'Draft discarded'
							: 'Preferences reloaded',
			});
		},
		onError: (error) =>
			toast.add({ type: 'error', title: 'Preferences operation failed', description: error.message }),
	});
	return { session, act: mutation.mutate, busy: mutation.isPending, error: mutation.error?.message };
}

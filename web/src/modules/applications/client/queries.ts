'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationChanges, DoneEvent, ManualInput, RunEvent, RunProgress } from '../model/contracts';
import * as api from './api';

export const applicationsOptions = (workspace: string) =>
	queryOptions({
		queryKey: ['applications', workspace],
		queryFn: ({ signal }) => api.loadApplications(workspace, signal),
		networkMode: 'always',
		retry: 1,
	});
export const useApplications = (workspace: string) => useQuery(applicationsOptions(workspace));

// Every change refetches the list, success or not, so the table always shows what is stored.
export function useApplicationMutations(workspace: string) {
	const client = useQueryClient();
	const onSettled = () => client.invalidateQueries({ queryKey: applicationsOptions(workspace).queryKey });
	return {
		add: useMutation({ mutationFn: (row: ManualInput) => api.addApplication(workspace, row), onSettled }),
		update: useMutation({
			mutationFn: ({ fingerprint, changes }: { fingerprint: string; changes: ApplicationChanges }) =>
				api.updateApplication(workspace, fingerprint, changes),
			onSettled,
		}),
		remove: useMutation({
			mutationFn: (fingerprint: string) => api.deleteApplication(workspace, fingerprint),
			onSettled,
		}),
	};
}

export type SearchRunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'failed';
export type RunBudgets = Extract<RunEvent, { type: 'started' }>['budgets'];
const noProgress: RunProgress = { processed: 0, matched: 0, skipped: 0 };
const noFailures = { jobs: 0, sources: 0 };

export function useSearchRun(workspace: string) {
	const client = useQueryClient();
	const controller = useRef<AbortController | null>(null);
	const [status, setStatus] = useState<SearchRunStatus>('idle');
	const [progress, setProgress] = useState(noProgress);
	const [budgets, setBudgets] = useState<RunBudgets | null>(null);
	const [failures, setFailures] = useState(noFailures);
	const [lastDone, setLastDone] = useState<DoneEvent | null>(null);
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(
		() =>
			client.invalidateQueries({
				queryKey: applicationsOptions(workspace).queryKey,
			}),
		[client, workspace],
	);
	const start = useCallback(async () => {
		if (controller.current) return;
		const current = (controller.current = new AbortController());
		setStatus('running');
		setProgress(noProgress);
		setBudgets(null);
		setFailures(noFailures);
		setLastDone(null);
		setError(null);
		let finished = false;
		try {
			for await (const event of api.runSearch(workspace, current.signal)) {
				if (event.type === 'started') setBudgets(event.budgets);
				if (event.type === 'progress')
					setProgress({
						processed: event.processed,
						matched: event.matched,
						skipped: event.skipped,
					});
				if (event.type === 'application') void refresh();
				if (event.type === 'job-failed') setFailures((count) => ({ ...count, jobs: count.jobs + 1 }));
				if (event.type === 'source-failed') setFailures((count) => ({ ...count, sources: count.sources + 1 }));
				if (event.type === 'done') {
					finished = true;
					setProgress(event.totals);
					setLastDone(event);
					setStatus(event.reason === 'failed' ? 'failed' : 'done');
					setError(event.error?.message ?? null);
					void refresh();
				}
			}
			if (!finished) throw new Error('The search stopped before it finished');
		} catch (failure) {
			// A client cancel closes the stream before the server's done event, so the last progress stands in for it.
			if (current.signal.aborted) setStatus('cancelled');
			else {
				setStatus('failed');
				setError(failure instanceof Error ? failure.message : 'Search run failed');
			}
			void refresh();
		} finally {
			if (controller.current === current) controller.current = null;
		}
	}, [workspace, refresh]);
	const cancel = useCallback(() => controller.current?.abort(), []);
	useEffect(() => () => controller.current?.abort(), []);
	return { start, cancel, status, progress, budgets, failures, lastDone, error };
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DoneEvent, RunProgress } from '../model/contracts';
import * as api from './api';

export const applicationsOptions = (workspace: string) =>
	queryOptions({
		queryKey: ['applications', workspace],
		queryFn: ({ signal }) => api.loadApplications(workspace, signal),
		networkMode: 'always',
		retry: 1,
	});
export const useApplications = (workspace: string) => useQuery(applicationsOptions(workspace));

export type SearchRunStatus = 'idle' | 'running' | 'done' | 'failed';
const noProgress: RunProgress = { processed: 0, matched: 0, skipped: 0 };

export function useSearchRun(workspace: string) {
	const client = useQueryClient();
	const controller = useRef<AbortController | null>(null);
	const [status, setStatus] = useState<SearchRunStatus>('idle');
	const [progress, setProgress] = useState(noProgress);
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
		setError(null);
		try {
			for await (const event of api.runSearch(workspace, current.signal)) {
				if (event.type === 'progress')
					setProgress({
						processed: event.processed,
						matched: event.matched,
						skipped: event.skipped,
					});
				if (event.type === 'application') void refresh();
				if (event.type === 'done') {
					setProgress(event.totals);
					setLastDone(event);
					setStatus(event.reason === 'failed' ? 'failed' : 'done');
					setError(event.error?.message ?? null);
					void refresh();
				}
			}
		} catch (failure) {
			if (current.signal.aborted) setStatus('idle');
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
	return { start, cancel, status, progress, lastDone, error };
}

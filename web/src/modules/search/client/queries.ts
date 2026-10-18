import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { PreferencesResult } from '../model/contracts';
import * as api from './api';
export const preferencesOptions = (workspace: string, sessionId: string) =>
	queryOptions({
		queryKey: ['search-preferences', workspace, sessionId],
		queryFn: async ({ signal }) => (await api.readSnapshot(workspace, signal)).snapshot,
		networkMode: 'always',
		retry: 1,
		refetchOnWindowFocus: 'always',
		// Preserve acknowledged object identity so a fresh disk rollback is still an external observation.
		structuralSharing: false,
	});
export async function commitPreferences(
	client: QueryClient,
	workspace: string,
	sessionId: string,
	operation: () => Promise<PreferencesResult>,
) {
	const queryKey = preferencesOptions(workspace, sessionId).queryKey;
	await client.cancelQueries({ queryKey });
	const result = await operation();
	await client.cancelQueries({ queryKey });
	client.setQueryData(queryKey, result.snapshot);
	return result.snapshot;
}

import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { processing, type ProfileResult, type ProfileSnapshot } from '../model/contracts';
import * as api from './api';
export const profileOptions = (workspace: string, sessionId: string) =>
	queryOptions({
		queryKey: ['profile', workspace, sessionId],
		queryFn: async ({ signal }) => (await api.readSnapshot(workspace, signal)).snapshot,
		networkMode: 'always',
		retry: 1,
		refetchInterval: (query) => (processing(query.state.data?.job ?? null) ? 1000 : false),
	});

/** Every write cancels older reads before and after the request, so they cannot roll it back. */
export async function commitProfile(
	client: QueryClient,
	workspace: string,
	sessionId: string,
	operation: () => Promise<ProfileResult>,
): Promise<ProfileSnapshot> {
	const key = profileOptions(workspace, sessionId).queryKey;
	await client.cancelQueries({ queryKey: key });
	const result = await operation();
	await client.cancelQueries({ queryKey: key });
	client.setQueryData(key, result.snapshot);
	return result.snapshot;
}

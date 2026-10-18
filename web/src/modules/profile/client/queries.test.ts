import { expect, test } from 'bun:test';
import { QueryClient, onlineManager, queryOptions } from '@tanstack/react-query';
import { profileOptions, commitProfile } from './queries';
import { emptyState, type ProfileSnapshot } from '../model/contracts';
const snapshot = (revision: string): ProfileSnapshot => ({ ...structuredClone(emptyState), profile: null, revision });
test('query identities isolate both workspaces and deliberate same-folder reloads', () => {
	expect(profileOptions('/a', '1').queryKey).not.toEqual(profileOptions('/b', '1').queryKey);
	expect(profileOptions('/a', '1').queryKey).not.toEqual(profileOptions('/a', '2').queryKey);
	expect(profileOptions('/a', '1').networkMode).toBe('always');
});
test('a late pre-mutation read cannot roll back acknowledged state', async () => {
	const client = new QueryClient();
	const options = profileOptions('/a', '1');
	let resolve!: (snapshot: ProfileSnapshot) => void;
	const read = client
		.fetchQuery(
			queryOptions({
				...options,
				queryFn: () =>
					new Promise<ProfileSnapshot>((done) => {
						resolve = done;
					}),
			}),
		)
		.catch(() => null);
	await commitProfile(client, '/a', '1', async () => ({ workspace: '/a', snapshot: snapshot('acknowledged') }));
	resolve(snapshot('stale'));
	await read;
	expect(client.getQueryData(options.queryKey)).toMatchObject({ revision: 'acknowledged' });
	client.clear();
});
test('localhost reads run while the browser reports no internet', async () => {
	const client = new QueryClient();
	onlineManager.setOnline(false);
	try {
		const result = await client.fetchQuery(
			queryOptions({ ...profileOptions('/a', '1'), queryFn: async () => snapshot('offline-local') }),
		);
		expect(result.revision).toBe('offline-local');
	} finally {
		onlineManager.setOnline(true);
		client.clear();
	}
});

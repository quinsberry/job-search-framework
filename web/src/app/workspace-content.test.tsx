import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyState } from '@/modules/profile/model/contracts';
import type { ProfileHandle } from '@/modules/profile/profile-section';
let onPreferencesPublished: (workspace: string) => void;
let section: { workspace: string | null; workspaceError: string; loadWorkspace: (path: string) => Promise<void> };
let sessionId: string | undefined;
let failFlush = false;
let failPreferencesFlush = false;
let preferenceFlushes = 0;
let preferenceDisposals = 0;
let flushes = 0;
let disposals = 0;
mock.module('@/modules/workspace/workspace-section', () => ({
	WorkspaceSection: (props: typeof section) => {
		section = props;
		return null;
	},
}));
mock.module('@/modules/profile/profile-section', () => ({
	ProfileSection: ({
		loaded,
		onSession,
	}: {
		loaded: { sessionId: string } | null;
		onSession: (handle: ProfileHandle | null) => void;
	}) => {
		sessionId = loaded?.sessionId;
		useEffect(() => {
			if (loaded)
				onSession({
					prepareToLeave: async () => {
						flushes++;
						if (failFlush) throw new Error('Recovery unavailable');
					},
					dispose: () => {
						disposals++;
					},
				});
			return () => onSession(null);
		}, [loaded, onSession]);
		return null;
	},
}));
mock.module('@/modules/agent/agent-section', () => ({ ActiveAgentSection: () => null }));
mock.module('@/modules/search/search-preferences-section', () => ({
	SearchPreferencesSection: ({
		loaded,
		onSession,
		onPublished,
	}: {
		loaded: { sessionId: string } | null;
		onSession: (handle: ProfileHandle | null) => void;
		onPublished: (workspace: string) => void;
	}) => {
		onPreferencesPublished = onPublished;
		useEffect(() => {
			if (loaded)
				onSession({
					prepareToLeave: async () => {
						preferenceFlushes++;
						if (failPreferencesFlush) throw new Error('Preferences recovery unavailable');
					},
					dispose: () => {
						preferenceDisposals++;
					},
				});
			return () => onSession(null);
		}, [loaded, onSession]);
		return null;
	},
}));
const { WorkspaceContent } = await import('./workspace-content');
const originalFetch = globalThis.fetch;
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
let renderer: ReactTestRenderer;
let client: QueryClient;
const requests: string[] = [];
beforeEach(() => {
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	failFlush = false;
	failPreferencesFlush = false;
	preferenceFlushes = 0;
	preferenceDisposals = 0;
	flushes = 0;
	disposals = 0;
	requests.length = 0;
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	globalThis.fetch = (async (url, options) => {
		const input = JSON.parse(String(options?.body));
		requests.push(input.workspace);
		if (
			input.workspace === '/invalid' ||
			(input.workspace === '/bad-preferences' && url === '/api/search-preferences')
		)
			return Response.json({ error: 'Invalid workspace', code: 'invalid' }, { status: 400 });
		return Response.json(
			url === '/api/workspace'
				? { workspace: input.workspace }
				: {
						workspace: input.workspace,
						snapshot:
							url === '/api/search-preferences'
								? { preferences: null, draft: null, revision: 'initial' }
								: { ...emptyState, profile: null, revision: 'initial' },
					},
		);
	}) as typeof fetch;
});
afterEach(async () => {
	await act(async () => renderer.unmount());
	client.clear();
	globalThis.fetch = originalFetch;
	if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
	else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});
test('workspace composition keeps the old editor on failed flush/load and deliberately remounts same-folder reloads', async () => {
	await act(async () => {
		renderer = create(
			<QueryClientProvider client={client}>
				<WorkspaceContent />
			</QueryClientProvider>,
		);
	});
	await act(async () => {
		await section.loadWorkspace('/first');
	});
	const initialSession = sessionId;
	expect(section.workspace).toBe('/first');
	failFlush = true;
	const before = requests.length;
	await act(async () => {
		await section.loadWorkspace('/second');
	});
	expect(requests.length).toBe(before);
	expect(section.workspace).toBe('/first');
	expect(sessionId).toBe(initialSession);
	failFlush = false;
	await act(async () => {
		await section.loadWorkspace('/invalid');
	});
	expect(section.workspaceError).toBe('Invalid workspace');
	expect(disposals).toBe(0);
	await act(async () => {
		await section.loadWorkspace('/first');
	});
	expect(section.workspace).toBe('/first');
	expect(sessionId).not.toBe(initialSession);
	expect(flushes).toBe(3);
	expect(disposals).toBe(1);
	expect(preferenceFlushes).toBe(3);
	expect(preferenceDisposals).toBe(1);
});

test('a preferences flush or target preferences load failure retains both editors', async () => {
	await act(async () => {
		renderer = create(
			<QueryClientProvider client={client}>
				<WorkspaceContent />
			</QueryClientProvider>,
		);
	});
	await act(async () => {
		await section.loadWorkspace('/first');
	});
	const initialSession = sessionId;
	failPreferencesFlush = true;
	const before = requests.length;
	await act(async () => {
		await section.loadWorkspace('/second');
	});
	expect(requests.length).toBe(before);
	expect(section.workspace).toBe('/first');
	expect(section.workspaceError).toBe('Preferences recovery unavailable');
	expect(sessionId).toBe(initialSession);
	failPreferencesFlush = false;
	await act(async () => {
		await section.loadWorkspace('/bad-preferences');
	});
	expect(section.workspace).toBe('/first');
	expect(disposals).toBe(0);
	expect(preferenceDisposals).toBe(0);
	await act(async () => {
		await section.loadWorkspace('/second');
	});
	expect(section.workspace).toBe('/second');
	expect(disposals).toBe(1);
	expect(preferenceDisposals).toBe(1);
});

test('published preferences invalidate only applications in the same workspace through app composition', async () => {
	await act(async () => {
		renderer = create(
			<QueryClientProvider client={client}>
				<WorkspaceContent />
			</QueryClientProvider>,
		);
	});
	client.setQueryData(['applications', '/first'], { applications: [], sources: [] });
	client.setQueryData(['applications', '/second'], { applications: [], sources: [] });
	await act(async () => {
		onPreferencesPublished('/first');
	});
	expect(client.getQueryState(['applications', '/first'])?.isInvalidated).toBe(true);
	expect(client.getQueryState(['applications', '/second'])?.isInvalidated).toBe(false);
});

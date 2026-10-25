import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { searchPreferencesSchema } from '@/domain/matching/criteria';
import type { PreferencesDraft } from '../model/schema';
import { toDraft, toPreferences } from '../model/form-model';
import type { PreferencesSnapshot } from '../model/contracts';
import { preferencesOptions } from './queries';
import { usePreferencesSession } from './use-preferences-session';
mock.module('@/shared/components/ui/toast', () => ({ toast: { add() {} } }));
let form: UseFormReturn<PreferencesDraft>;
let editing: ReturnType<typeof usePreferencesSession>;
let server: PreferencesSnapshot;
let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
const requests: { action: string; revision?: string; values?: PreferencesDraft }[] = [];
const listeners = new Map<string, () => void>();
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
const published: string[] = [];
const attach = () => {};
const onPublished = (workspace: string) => {
	published.push(workspace);
};
function Probe({ initial }: { initial: PreferencesSnapshot }) {
	const current = useForm<PreferencesDraft>({ defaultValues: toDraft(initial.preferences) });
	const { data = initial } = useQuery({
		...preferencesOptions('/fixture', 'test'),
		initialData: initial,
		staleTime: Infinity,
	});
	const session = usePreferencesSession({
		workspace: '/fixture',
		sessionId: 'test',
		initial,
		snapshot: data,
		form: current,
		onSession: attach,
		onPublished,
	});
	useEffect(() => {
		form = current;
		editing = session;
	});
	return null;
}
beforeEach(() => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
			removeEventListener: (name: string) => listeners.delete(name),
		},
	});
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	server = {
		revision: '0',
		draft: null,
		preferences: searchPreferencesSchema.parse({
			targetPosition: {
				positionTitles: ['Original'],
				seniority: ['senior'],
				positionType: ['full-time'],
				workArrangements: ['remote'],
				salaryRange: [],
			},
			settings: { maxJobsToProcess: 100, maxJobsToMatch: 10 },
		}),
	};
	requests.length = 0;
	published.length = 0;
	globalThis.fetch = mock(async (_url, options) => {
		const input = JSON.parse(String(options?.body));
		requests.push(input);
		if (input.action !== 'load') {
			if (input.revision !== server.revision)
				return Response.json({ error: 'Changed externally', code: 'conflict' }, { status: 409 });
			server = { ...server, revision: server.revision + '1' };
			if (input.action === 'edit')
				server.draft = { id: 'a'.repeat(8) + '-aaaa-4aaa-8aaa-' + 'a'.repeat(12), values: input.values };
			if (input.action === 'publish') {
				server.preferences = searchPreferencesSchema.parse(toPreferences(input.values));
				server.draft = null;
			}
			if (input.action === 'discard') server.draft = null;
		}
		return Response.json({ workspace: '/fixture', snapshot: server });
	}) as unknown as typeof fetch;
});
afterEach(async () => {
	await act(async () => renderer?.unmount());
	renderer = undefined;
	client.clear();
	listeners.clear();
	globalThis.fetch = originalFetch;
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
	if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
	else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});
async function mount() {
	await act(async () => {
		renderer = create(
			<QueryClientProvider client={client}>
				<Probe initial={structuredClone(server)} />
			</QueryClientProvider>,
		);
	});
}
test('unfinished numeric text is acknowledged without changing the form or active preferences', async () => {
	await mount();
	await act(async () => {
		form.setValue('settings.maxJobsToProcess', 'unfinished');
		await editing.session.flush();
	});
	expect(form.getValues('settings.maxJobsToProcess')).toBe('unfinished');
	expect(server.draft?.values.settings.maxJobsToProcess).toBe('unfinished');
	expect(server.preferences?.settings.maxJobsToProcess).toBe(100);
	expect(published).toEqual([]);
	expect(editing.session.getState().status).toBe('clean');
});
test('Save and Discard reconcile revisions and baseline before further edits', async () => {
	await mount();
	await act(async () => {
		form.setValue('targetPosition.positionTitles', ['Saved']);
	});
	await act(async () => {
		editing.act('publish');
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	expect(server.preferences?.targetPosition.positionTitles).toEqual(['Saved']);
	expect(published).toEqual(['/fixture']);
	expect(editing.session.getState().baseline?.targetPosition.positionTitles).toEqual(['Saved']);
	await act(async () => {
		form.setValue('targetPosition.positionTitles', ['Discard me']);
	});
	await act(async () => {
		editing.act('discard');
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	expect(form.getValues('targetPosition.positionTitles')).toEqual(['Saved']);
	expect(published).toEqual(['/fixture']);
	const accepted = server.revision;
	await act(async () => {
		form.setValue('targetPosition.positionTitles', ['Next']);
		await editing.session.flush();
	});
	expect(requests.at(-1)?.revision).toBe(accepted);
	expect(editing.session.getState().status).toBe('clean');
});
test('focus refetch exposes external changes without resetting edits; explicit reload adopts them', async () => {
	await mount();
	server = {
		...server,
		revision: 'external',
		preferences: { ...server.preferences!, settings: { maxJobsToProcess: 200, maxJobsToMatch: 20 } },
	};
	await act(async () => {
		listeners.get('focus')?.();
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	expect(editing.session.getState().status).toBe('conflicted');
	expect(form.getValues('settings.maxJobsToProcess')).toBe('100');
	await act(async () => {
		form.setValue('settings.maxJobsToProcess', '150');
	});
	await expect(editing.session.flush()).rejects.toThrow('changed');
	await act(async () => {
		editing.act('reload');
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	expect(form.getValues('settings.maxJobsToProcess')).toBe('200');
	expect(editing.session.getState().status).toBe('clean');
	await act(async () => {
		form.setValue('settings.maxJobsToMatch', '25');
		await editing.session.flush();
	});
	expect(requests.at(-1)?.revision).toBe('external');
	expect(published).toEqual([]);
});

test('failed publication never notifies applications', async () => {
	await mount();
	server = { ...server, revision: 'external' };
	await act(async () => {
		editing.act('publish');
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	expect(editing.error).toBeTruthy();
	expect(published).toEqual([]);
});

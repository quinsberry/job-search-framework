import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { emptyState, recordIdsFor, type ProfileSnapshot } from '../model/contracts';
import { emptyProfile, profileSchema, toDraft } from '../model/schema';
import { initialFormValues, fromFormValues, type FormValues } from '../model/form-model';
import { useProfileSession, type ProfileFormApi, type ProfileHandle } from './use-profile-session';
import { profileOptions } from './queries';
mock.module('@/shared/components/ui/toast', () => ({ toast: { add() {} } }));
let form: ProfileFormApi;
let handle: ProfileHandle | null;
let snapshot: ProfileSnapshot;
let renderer: ReactTestRenderer | undefined;
let client: QueryClient;
const edits: { revision: string; values: unknown; recordIds: unknown }[] = [];
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
function savedProfile(name: string, revision: string): ProfileSnapshot {
	const profile = profileSchema.parse({
		...emptyProfile,
		identity: { fullName: name },
		experience: [{ company: name, role: 'Engineer' }],
	});
	return { ...structuredClone(emptyState), profile, revision, recordIds: recordIdsFor(toDraft(profile)) };
}
const attach = (value: ProfileHandle | null) => {
	handle = value;
};
function Probe({ initial, sessionId }: { initial: ProfileSnapshot; sessionId: string }) {
	const current = useForm<FormValues>({ defaultValues: initialFormValues(initial) });
	const { data = initial } = useQuery({
		...profileOptions('/fixture', sessionId),
		initialData: initial,
		staleTime: Infinity,
	});
	useProfileSession({
		workspace: '/fixture',
		sessionId,
		initial,
		snapshot: data,
		form: current,
		provider: 'codex',
		onSession: attach,
	});
	useEffect(() => {
		form = current;
	}, [current]);
	return null;
}
function tree(initial: ProfileSnapshot, sessionId: string) {
	return (
		<QueryClientProvider client={client}>
			<Probe key={sessionId} initial={initial} sessionId={sessionId} />
		</QueryClientProvider>
	);
}
beforeEach(() => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { addEventListener() {}, removeEventListener() {} },
	});
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	snapshot = savedProfile('Original', 'original-revision');
	edits.length = 0;
	globalThis.fetch = mock(async (_url, options) => {
		const input = JSON.parse(String(options?.body));
		if (input.action === 'edit') {
			edits.push(input);
			snapshot = { ...snapshot, revision: 'recovered-revision' };
		}
		return Response.json({ workspace: '/fixture', snapshot });
	}) as unknown as typeof fetch;
});
afterEach(async () => {
	await act(async () => renderer?.unmount());
	renderer = undefined;
	client.clear();
	globalThis.fetch = originalFetch;
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
	if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
	else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});
test('reloading the same workspace replaces form values and row IDs before the next recovery write', async () => {
	await act(async () => {
		renderer = create(tree(snapshot, 'first'));
	});
	expect(form.getValues('identity.fullName')).toBe('Original');
	snapshot = savedProfile('External update', 'external-revision');
	const externalIds = snapshot.recordIds;
	await act(async () => {
		await handle?.prepareToLeave();
		renderer!.update(tree(snapshot, 'second'));
	});
	expect(form.getValues('identity.fullName')).toBe('External update');
	expect(fromFormValues(form.getValues()).recordIds).toEqual(externalIds);
	await act(async () => {
		form.setValue('identity.summary', 'New note');
	});
	await act(async () => {
		await handle?.prepareToLeave();
	});
	expect(edits[0]).toMatchObject({
		revision: 'external-revision',
		values: { identity: { fullName: 'External update', summary: 'New note' } },
		recordIds: externalIds,
	});
});
test('ordinary query refresh and recovery acknowledgments do not reset newer form edits or rebase its cursor', async () => {
	await act(async () => {
		renderer = create(tree(snapshot, 'first'));
	});
	const originalForm = form;
	await act(async () => {
		form.setValue('identity.summary', 'Still typing');
		client.setQueryData(profileOptions('/fixture', 'first').queryKey, {
			...snapshot,
			revision: 'unrelated-refetch',
		});
	});
	expect(form).toBe(originalForm);
	expect(form.getValues('identity.summary')).toBe('Still typing');
	await act(async () => {
		await handle?.prepareToLeave();
	});
	expect(edits[0].revision).toBe('original-revision');
	expect(form.getValues('identity.summary')).toBe('Still typing');
});

import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Application, RunEvent } from './model/contracts';

// Base UI menus and selects need a DOM document, which react-test-renderer lacks; the table itself stays real.
mock.module('./application-table/applications-table-view-options', () => ({
	ApplicationsTableViewOptions: () => null,
}));
mock.module('./application-table/applications-table-pagination', () => ({ ApplicationsTablePagination: () => null }));
mock.module('./application-table/applications-table-column-header', () => ({
	ApplicationsTableColumnHeader: ({ title }: { title: string }) => title,
}));
// The dialogs and the status select are Base UI too; the stubs expose their props so the tests can drive them.
type Props = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let statusSelect: Props = {};
let dialog: Props = {};
let deleteDialog: Props = {};
mock.module('./application-table/status-select', () => ({
	statusOptions: [],
	statusFilterOptions: [],
	OptionSelect: (props: Props) => {
		if (String(props.label).startsWith('Status of')) statusSelect = props;
		return null;
	},
}));
mock.module('./application-table/row-actions', () => ({
	RowActions: ({ title, onEdit, onDelete }: Props) => (
		<>
			<button aria-label={`Edit ${title}`} onClick={onEdit} />
			<button aria-label={`Delete ${title}`} onClick={onDelete} />
		</>
	),
}));
mock.module('./application-table/application-dialog', () => ({
	ApplicationDialog: (props: Props) => {
		dialog = props;
		return null;
	},
}));
mock.module('./application-table/delete-dialog', () => ({
	DeleteDialog: (props: Props) => {
		deleteDialog = props;
		return null;
	},
}));
const { ApplicationsSection } = await import('./applications-section');

const originalFetch = globalThis.fetch;
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
});
afterEach(async () => {
	await act(async () => renderer?.unmount());
	renderer = undefined;
	globalThis.fetch = originalFetch;
	if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
	else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

const application: Application = {
	fingerprint: 'a'.repeat(64),
	job: {
		sourceId: 'linkedin',
		sourceJobId: '1',
		url: 'https://www.linkedin.com/jobs/view/1',
		title: 'Senior Angular Developer',
		company: { name: 'Sii Poland', url: null },
		locations: [{ label: 'Warsaw, Poland', city: 'Warsaw', country: 'Poland' }],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		availability: 'open',
	},
	match: {
		outcome: 'needs-clarification',
		criteria: [{ criterion: 'salary', result: 'unknown', evidence: 'structured', detail: 'Salary not advertised' }],
		costUsd: 0.0001,
	},
	addedAt: '2026-10-22T00:00:00Z',
	origin: 'search',
	status: 'new',
	expectedSalary: null,
};
const sources = [{ id: 'linkedin', name: 'LinkedIn', supportedFilters: [] }];
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
async function render(
	route: Route,
	loaded: { workspace: string; sessionId: string } | null = { workspace: '/w', sessionId: 's' },
) {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
		route(String(input), init)) as typeof fetch;
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => {
		renderer = create(
			<QueryClientProvider client={client}>
				<ApplicationsSection loaded={loaded} />
			</QueryClientProvider>,
		);
	});
	return renderer!;
}
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
type Node = ReactTestRenderer['root'];
const content = (node: Node | string): string =>
	typeof node === 'string' ? node : node.children.map(content).join('');
const button = (tree: ReactTestRenderer, label: string) =>
	tree.root.find(
		(node) => node.type === 'button' && (node.props['aria-label'] === label || content(node).includes(label)),
	);
// Queries and streams settle over several ticks; poll inside act until the screen shows the text.
async function waitFor(tree: ReactTestRenderer, expected: string) {
	for (let attempt = 0; attempt < 300 && !text(tree).includes(expected); attempt++)
		await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
	expect(text(tree)).toContain(expected);
}

test('asks for a workspace when none is open', async () => {
	const tree = await render(() => json({}), null);
	expect(text(tree)).toContain('Open a workspace to see applications.');
});

test('renders stored applications with a muted unadvertised salary', async () => {
	const tree = await render(() => json({ applications: [application], sources }));
	await waitFor(tree, 'Senior Angular Developer');
	const rendered = text(tree);
	expect(rendered).toContain('Senior Angular Developer');
	// Source is hidden by default until there is a second one; its name mapping is covered in rows.test.ts.
	expect(rendered).not.toContain('LinkedIn');
	expect(rendered).toContain('salary not advertised');
	expect(rendered).toContain('Needs clarification');
	await act(async () => button(tree, 'Show criteria').props.onClick());
	await waitFor(tree, 'Salary not advertised');
});

test('shows the empty state, and a load error with retry', async () => {
	await waitFor(await render(() => json({ applications: [], sources })), 'No applications yet.');
	await act(async () => renderer?.unmount());

	let calls = 0;
	const tree = await render(() =>
		// The load query retries once, so the first two calls fail.
		++calls <= 2
			? json({ error: 'Applications file is invalid', code: 'invalid-input' }, 400)
			: json({ applications: [application], sources }),
	);
	await waitFor(tree, 'Applications file is invalid');
	await act(async () => button(tree, 'Retry').props.onClick());
	await waitFor(tree, 'Senior Angular Developer');
});

test('search streams progress, can be cancelled, and reports preflight errors inline', async () => {
	let push!: (event: RunEvent) => void;
	let run = 0;
	const tree = await render((url, init) => {
		if (!url.endsWith('/run')) return json({ applications: [], sources });
		if (++run === 2) return json({ error: 'A search is already running', code: 'conflict' }, 409);
		const encoder = new TextEncoder();
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					push = (event) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
					init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
				},
			}),
		);
	});
	await waitFor(tree, 'No applications yet.');
	let finished!: Promise<void>;
	await act(async () => {
		finished = button(tree, 'Search').props.onClick();
	});
	expect(text(tree)).toContain('Starting…');
	await act(async () => {
		push({ type: 'started', budgets: { process: 50, match: 10 } });
		push({ type: 'progress', processed: 2, matched: 0, skipped: 5 });
	});
	await waitFor(tree, 'Inspected 2 / 50 · Found 0 / 10 · Skipped 5');
	await act(async () => {
		button(tree, 'Cancel').props.onClick();
		await finished;
	});
	await waitFor(tree, 'Search cancelled · 2 inspected · 5 skipped');

	await act(async () => button(tree, 'Search').props.onClick());
	await waitFor(tree, 'A search is already running');
});

test('status changes, add, edit and delete call the list actions and handle errors', async () => {
	const calls: Record<string, unknown>[] = [];
	let rows: Application[] = [application];
	let gone = false;
	const tree = await render((url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		if (body.action === 'load') return json({ applications: rows, sources });
		calls.push(body);
		if (body.action === 'add' && (body.row as { title: string }).title === 'Duplicate')
			return json({ error: 'This vacancy is already in your applications.', code: 'conflict' }, 409);
		if (body.action === 'update' && gone)
			return json({ error: 'This application no longer exists.', code: 'not-found' }, 404);
		if (body.action === 'update') {
			rows = [{ ...application, ...(body.changes as object) }];
			return json({ row: rows[0] });
		}
		if (body.action === 'delete') {
			rows = [];
			return json({});
		}
		return json({ row: { ...manualRow, ...(body.row as object) } });
	});
	await waitFor(tree, 'Senior Angular Developer');

	// Inline status change saves at once and refetches.
	await act(async () => statusSelect.onChange('applied'));
	await waitFor(tree, '"Senior Angular Developer"');
	expect(calls.at(-1)).toMatchObject({
		action: 'update',
		fingerprint: application.fingerprint,
		changes: { status: 'applied' },
	});
	await waitForValue(() => statusSelect.value === 'applied');

	// Adding: a duplicate keeps the dialog open with the message; a new vacancy closes it.
	await act(async () => button(tree, 'Add application').props.onClick());
	expect(dialog.target).toBe('new');
	await act(async () => dialog.onSubmit({ url: 'https://example.com', title: 'Duplicate', status: 'new' }));
	await waitForValue(() => dialog.error === 'This vacancy is already in your applications.');
	expect(dialog.target).toBe('new');
	await act(async () => dialog.onSubmit({ url: 'https://example.com', title: 'Fresh role', status: 'new' }));
	await waitForValue(() => dialog.target === null);
	expect(calls.at(-1)).toMatchObject({ action: 'add', row: { title: 'Fresh role' } });

	// Saving an edit to a row deleted meanwhile closes the dialog.
	await act(async () => button(tree, 'Edit Senior Angular Developer').props.onClick());
	expect(dialog.target.title).toBe('Senior Angular Developer');
	gone = true;
	await act(async () => dialog.onSubmit({ status: 'offer', expectedSalary: null }));
	await waitForValue(() => dialog.target === null);
	gone = false;

	// Deleting asks first, then removes the row.
	await act(async () => button(tree, 'Delete Senior Angular Developer').props.onClick());
	expect(deleteDialog.row.title).toBe('Senior Angular Developer');
	await act(async () => deleteDialog.onConfirm(deleteDialog.row));
	await waitForValue(() => deleteDialog.row === null);
	expect(calls.at(-1)).toEqual({ action: 'delete', workspace: '/w', fingerprint: application.fingerprint });
	await waitFor(tree, 'No applications yet.');
});

const manualRow = {
	origin: 'manual',
	fingerprint: 'b'.repeat(64),
	status: 'new',
	expectedSalary: null,
	addedAt: '2026-10-23T00:00:00Z',
	url: 'https://example.com',
	title: 'Fresh role',
	company: null,
	location: null,
	salary: null,
};
async function waitForValue(check: () => boolean) {
	for (let attempt = 0; attempt < 300 && !check(); attempt++)
		await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
	expect(check()).toBe(true);
}

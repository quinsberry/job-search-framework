import { afterEach, expect, test } from 'bun:test';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RunEvent } from '../model/contracts';
import { readEvents } from './api';
import { applicationsOptions, useSearchRun } from './queries';

const originalFetch = globalThis.fetch;
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
	else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

const record = {
	fingerprint: 'a'.repeat(64),
	job: {
		sourceId: 'linkedin',
		sourceJobId: '1',
		url: 'https://www.linkedin.com/jobs/view/1',
		title: 'Développeur',
		company: null,
		locations: [],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		availability: 'open',
	},
	match: { outcome: 'match', criteria: [], costUsd: 0.1 },
	matchedAt: '2026-10-22T00:00:00Z',
} satisfies Extract<RunEvent, { type: 'application' }>['record'];
const events: RunEvent[] = [
	{ type: 'started', budgets: { process: 5, match: 2 } },
	{ type: 'application', record },
	{ type: 'progress', processed: 1, matched: 1, skipped: 0 },
	{
		type: 'done',
		reason: 'exhausted',
		totals: { processed: 1, matched: 1, skipped: 0 },
		costUsd: 0.1,
		unpricedCalls: 0,
	},
];
// Split every few bytes so lines and multi-byte characters straddle chunks.
function splitStream(text: string) {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (let offset = 0; offset < bytes.length; offset += 7)
				controller.enqueue(bytes.slice(offset, offset + 7));
			controller.close();
		},
	});
}
const ndjson = events.map((event) => JSON.stringify(event)).join('\n') + '\n';

test('readEvents reassembles split NDJSON', async () => {
	const read = [];
	for await (const event of readEvents(splitStream(ndjson))) read.push(event);
	expect(read).toEqual(events as never);
});

test('useSearchRun reports progress and refreshes applications', async () => {
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
		configurable: true,
		value: true,
	});
	globalThis.fetch = (async () => new Response(splitStream(ndjson))) as unknown as typeof fetch;
	const client = new QueryClient();
	let invalidated = 0;
	const original = client.invalidateQueries.bind(client);
	client.invalidateQueries = ((filters) => {
		if (JSON.stringify(filters?.queryKey) === JSON.stringify(applicationsOptions('/fixture').queryKey))
			invalidated++;
		return original(filters);
	}) as typeof client.invalidateQueries;
	let session!: ReturnType<typeof useSearchRun>;
	function Probe() {
		const current = useSearchRun('/fixture');
		useEffect(() => {
			session = current;
		});
		return null;
	}
	let renderer: ReactTestRenderer | undefined;
	await act(async () => {
		renderer = create(
			<QueryClientProvider client={client}>
				<Probe />
			</QueryClientProvider>,
		);
	});
	await act(() => session.start());
	expect(session.status).toBe('done');
	expect(session.progress).toEqual({ processed: 1, matched: 1, skipped: 0 });
	expect(session.lastDone?.reason).toBe('exhausted');
	expect(invalidated).toBe(2);
	await act(async () => renderer?.unmount());
});

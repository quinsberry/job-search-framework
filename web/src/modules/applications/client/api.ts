import { z } from 'zod';
import { request, RequestError } from '@/shared/http/client';
import { loadResultSchema, runEventSchema, type RunEvent } from '../model/contracts';

export const loadApplications = (workspace: string, signal?: AbortSignal) =>
	request('/api/applications', { action: 'load', workspace }, loadResultSchema, signal);

// Yields validated events from an NDJSON body; chunks may split or join lines arbitrarily.
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
	const decoder = new TextDecoder();
	let buffer = '';
	const reader = body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) if (line.trim()) yield runEventSchema.parse(JSON.parse(line));
	}
	buffer += decoder.decode();
	if (buffer.trim()) yield runEventSchema.parse(JSON.parse(buffer));
}

export async function* runSearch(workspace: string, signal: AbortSignal): AsyncGenerator<RunEvent> {
	const response = await fetch('/api/applications/run', {
		method: 'POST',
		signal,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ workspace }),
	});
	if (!response.ok || !response.body) {
		const error = z.object({ error: z.string(), code: z.string() }).parse(await response.json());
		throw new RequestError(error.error, error.code);
	}
	yield* readEvents(response.body);
}

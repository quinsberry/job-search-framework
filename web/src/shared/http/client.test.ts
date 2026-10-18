import { expect, test } from 'bun:test';
import { z } from 'zod';
import { request, RequestError } from './client';
test('transport validates responses, forwards cancellation and preserves structured errors', async () => {
	const original = globalThis.fetch;
	const controller = new AbortController();
	let response = Response.json({ wrong: true });
	globalThis.fetch = (async (_url, input) => {
		expect(input?.signal).toBe(controller.signal);
		return response;
	}) as typeof fetch;
	try {
		await expect(request('/fixture', {}, z.object({ name: z.string() }), controller.signal)).rejects.toThrow();
		response = Response.json({ error: 'Changed externally', code: 'conflict' }, { status: 409 });
		try {
			await request('/fixture', {}, z.object({ name: z.string() }), controller.signal);
			throw new Error('Expected conflict');
		} catch (error) {
			expect(error).toBeInstanceOf(RequestError);
			expect(error).toHaveProperty('code', 'conflict');
		}
	} finally {
		globalThis.fetch = original;
	}
});

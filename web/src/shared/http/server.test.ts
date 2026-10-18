import { expect, test } from 'bun:test';
import { localRequest } from './server';
test('bounds the actual stream before parsing, even without Content-Length', async () => {
	let parsed = false;
	const request = new Request('http://localhost:3107/api/fixture', {
		method: 'POST',
		headers: { host: 'localhost:3107', origin: 'http://localhost:3107' },
		body: new Uint8Array(10 * 1024 * 1024 + 64 * 1024 + 1),
	});
	const response = await localRequest(request, async () => {
		parsed = true;
		return {};
	});
	expect(response.status).toBe(400);
	expect(parsed).toBe(false);
	expect(await response.json()).toHaveProperty('code', 'invalid');
});

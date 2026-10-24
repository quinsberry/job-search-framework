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
// `next start` builds request.url from its configured hostname, not the Host header the browser sent.
const post = (host: string, origin: string) =>
	new Request('http://localhost:3107/api/fixture', { method: 'POST', headers: { host, origin }, body: '{}' });
test('accepts any loopback name the browser used, whatever request.url says', async () => {
	for (const host of ['localhost:3107', '127.0.0.1:3107', '[::1]:3107']) {
		const response = await localRequest(post(host, `http://${host}`), async () => ({}));
		expect(response.status).toBe(200);
	}
});
test('rejects non-loopback hosts and cross-origin callers', async () => {
	for (const [host, origin] of [
		['evil.example:3107', 'http://evil.example:3107'],
		['127.0.0.1:3107', 'http://evil.example'],
		['127.0.0.1:3107', 'http://localhost:3107'],
		['a b:3107', 'http://a b:3107'],
	]) {
		const response = await localRequest(post(host, origin), async () => ({}));
		expect(response.status).toBe(403);
	}
});

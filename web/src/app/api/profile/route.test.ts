import { expect, test } from 'bun:test';
import { POST } from './route';

test('rejects unsupported providers for multipart imports and JSON retries before opening a workspace', async () => {
	const data = new FormData();
	data.set('workspace', '/does-not-exist');
	data.set('revision', 'revision');
	data.set('provider', 'claude');
	data.set('file', new File(['CV'], 'cv.md'));
	for (const body of [
		data,
		JSON.stringify({ action: 'retry', workspace: '/does-not-exist', revision: 'revision', provider: 'claude' }),
	]) {
		const response = await POST(
			new Request('http://localhost:3000/api/profile', {
				method: 'POST',
				headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
				body,
			}),
		);
		expect(response.status).toBe(400);
		expect((await response.json()).error).toContain('"codex"');
	}
});

test('rejects nonlocal hosts and cross-origin filesystem requests before reading their bodies', async () => {
	for (const [url, host, origin] of [
		['http://localhost:3000/api/profile', 'localhost:3000', 'https://attacker.example'],
		['http://attacker.example/api/profile', 'attacker.example', 'http://attacker.example'],
		['http://localhost:3000/api/profile', 'attacker.example', 'http://localhost:3000'],
	]) {
		const response = await POST(new Request(url, { method: 'POST', headers: { host, origin }, body: '{}' }));
		expect(response.status).toBe(403);
	}
});

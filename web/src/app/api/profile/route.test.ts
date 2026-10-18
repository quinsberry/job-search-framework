import { expect, test } from 'bun:test';
import { POST } from './route';

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

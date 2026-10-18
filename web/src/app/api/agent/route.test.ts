import { expect, test } from 'bun:test';
import { POST } from './route';

test('rejects unsupported providers before checking readiness', async () => {
	for (const provider of ['claude', 'unknown', '', null]) {
		const response = await POST(
			new Request('http://localhost:3000/api/agent', {
				method: 'POST',
				headers: {
					host: 'localhost:3000',
					origin: 'http://localhost:3000',
					'content-type': 'application/json',
				},
				body: JSON.stringify({ provider }),
			}),
		);
		expect(response.status).toBe(400);
		expect((await response.json()).error).toContain('provider:');
	}
});

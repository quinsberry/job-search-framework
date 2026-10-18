import { expect, test } from 'bun:test';
import { POST } from './route';
test('preferences route rejects foreign origins and invalid commands before touching storage', async () => {
	const request = (origin: string, body: unknown) =>
		new Request('http://localhost:3000/api/search-preferences', {
			method: 'POST',
			headers: { host: 'localhost:3000', origin, 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
	expect((await POST(request('https://foreign.example', { action: 'load', workspace: '/never-open' }))).status).toBe(
		403,
	);
	expect((await POST(request('http://localhost:3000', { action: 'erase', workspace: '/never-open' }))).status).toBe(
		400,
	);
});

import { afterEach, expect, test } from 'bun:test';
import { linkedinProvider as provider } from './provider';
import { discoveryRequest } from './search';
import { htmlFetch } from './http';
import { validateReference } from './detail';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const signal = () => new AbortController().signal;
const ref = { sourceId: 'linkedin' as const, sourceJobId: '123456', url: 'https://www.linkedin.com/jobs/view/123456' };
const fixture = (name: string) => Bun.file(new URL(`./fixtures/${name}.html`, import.meta.url)).text();
function respond(body: string, status = 200, headers?: HeadersInit) {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response(body, { status, headers });
	}) as unknown as typeof fetch;
	return () => calls;
}

test('discovery maps all arrangements and reports approximate hints', () => {
	const result = discoveryRequest(
		{
			query: 'engineer',
			location: 'Poland',
			workArrangements: ['remote', 'on-site'],
			publishedAfter: '2026-10-01T00:00:00Z',
		},
		20,
		Date.parse('2026-10-02T00:00:00Z'),
	);
	const params = new URL(result.url).searchParams;
	expect(params.get('f_WT')).toBe('2,1');
	expect(params.get('f_TPR')).toBe('r86400');
	expect(params.get('start')).toBe('20');
	expect(result.filters.map((item) => item.application)).toEqual(['approximate', 'applied', 'approximate']);
});

test('native overflow survives small limits without another fetch', async () => {
	const calls = respond(await fixture('search'));
	const first = await provider.search({ query: { query: 'engineer' }, limit: 1 }, signal());
	expect(first.jobs[0].publishedAt).toBe('2026-10-01');
	const second = await provider.search(
		{ query: { query: 'engineer' }, limit: 1, cursor: first.nextCursor! },
		signal(),
	);
	expect(second.jobs[0].sourceJobId).toBe('123457');
	expect(calls()).toBe(1);
	respond(await fixture('empty'));
	expect(
		(await provider.search({ query: { query: 'engineer' }, limit: 1, cursor: second.nextCursor! }, signal()))
			.nextCursor,
	).toBeNull();
});

test('invalid input, cursors and unsafe references fail before fetching', async () => {
	const calls = respond('');
	for (const cursor of ['garbage', '{}', '{"start":-1,"pending":[]}'])
		await expect(
			provider.search({ query: { query: 'engineer' }, limit: 1, cursor }, signal()),
		).rejects.toMatchObject({ code: 'invalid-input' });
	await expect(provider.search({ query: { query: '' }, limit: 0 }, signal())).rejects.toMatchObject({
		code: 'invalid-input',
	});
	for (const url of [
		'http://127.0.0.1/jobs/view/123456',
		'https://www.linkedin.com/jobs/view/999999',
		'https://www.linkedin.com.evil.test/jobs/view/123456',
	])
		expect(() => validateReference({ ...ref, url })).toThrow();
	expect(calls()).toBe(0);
});

test('detail retains paragraphs, unknown availability and explicit unknown facts', async () => {
	respond(await fixture('detail'));
	const result = await provider.getDetail(ref, signal());
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.job.availability).toBe('unknown');
	expect(result.job.description).toContain('tools.\n');
	expect(result.job.description).toContain('Ship software\n');
	expect(result.job.description).toContain('😀');
	expect(result.job.publishedAt).toBeNull();
	expect(result.job.advertisedFacts?.compensation).toBeNull();
	respond(await fixture('closed'));
	const closed = await provider.getDetail(ref, signal());
	expect(closed.ok && closed.job.availability).toBe('closed');
});

test('blocked, malformed, empty and missing pages stay distinct', async () => {
	for (const [name, code] of [
		['blocked', 'blocked'],
		['malformed', 'invalid-response'],
		['empty', 'invalid-response'],
	] as const) {
		respond(await fixture(name));
		const detail = await provider.getDetail(ref, signal());
		expect(!detail.ok && detail.error.code).toBe(code);
	}
	for (const [name, code] of [
		['blocked', 'blocked'],
		['malformed', 'invalid-response'],
	]) {
		respond(await fixture(name));
		await expect(provider.search({ query: { query: 'engineer' }, limit: 5 }, signal())).rejects.toMatchObject({
			code,
		});
	}
	respond('', 404);
	const missing = await provider.getDetail(ref, signal());
	expect(!missing.ok && missing.error.code).toBe('not-found');
	respond('<div data-entity-urn="urn:li:jobPosting:123456">missing title</div>');
	await expect(provider.search({ query: { query: 'x' }, limit: 2 }, signal())).rejects.toMatchObject({
		code: 'invalid-response',
	});
});

test('expiry and description boilerplate do not become publication or closure evidence', async () => {
	respond(
		'<time datetime="2026-11-01" class="expiry">Expires</time>' +
			(await fixture('detail')).replace(
				'Nested content',
				'No longer accepting applications; build captcha tools',
			) +
			'<a href="/authwall">Sign in</a>',
	);
	const result = await provider.getDetail(ref, signal());
	expect(result.ok && result.job.publishedAt).toBeNull();
	expect(result.ok && result.job.availability).toBe('unknown');
});

test('transient HTTP and network errors retry only within the configured bound', async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		if (calls === 1) throw new TypeError('Fictional connection loss');
		if (calls === 2) return new Response('', { status: 503 });
		return new Response(await fixture('detail'));
	}) as unknown as typeof fetch;
	expect((await provider.getDetail(ref, signal())).ok).toBe(true);
	expect(calls).toBe(3);
	const exhausted = respond('', 429, { 'retry-after': '0' });
	const result = await provider.getDetail(ref, signal());
	expect(!result.ok && result.error.code).toBe('rate-limited');
	expect(exhausted()).toBe(3);
});

test('response bodies are bounded', async () => {
	respond('x', 200, { 'content-length': String(3 * 1024 * 1024) });
	await expect(htmlFetch('https://www.linkedin.com/', signal())).rejects.toMatchObject({ code: 'invalid-response' });
	respond('x'.repeat(2 * 1024 * 1024 + 1));
	await expect(htmlFetch('https://www.linkedin.com/', signal())).rejects.toMatchObject({ code: 'invalid-response' });
});

test('cancellation stops before fetch, during body reading and during retry delay', async () => {
	const before = new AbortController();
	before.abort();
	const calls = respond('');
	await expect(htmlFetch('https://www.linkedin.com/', before.signal)).rejects.toMatchObject({ code: 'cancelled' });
	expect(calls()).toBe(0);
	const reading = new AbortController();
	globalThis.fetch = (async () =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('partial'));
				},
			}),
		)) as unknown as typeof fetch;
	const pending = htmlFetch('https://www.linkedin.com/', reading.signal);
	setTimeout(() => reading.abort(), 5);
	await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
	const waiting = new AbortController();
	const retryCalls = respond('', 429, { 'retry-after': '1' });
	const retrying = htmlFetch('https://www.linkedin.com/', waiting.signal);
	setTimeout(() => waiting.abort(), 5);
	await expect(retrying).rejects.toMatchObject({ code: 'cancelled' });
	expect(retryCalls()).toBe(1);
});

test('Retry-After is bounded and deadlines stop retries', async () => {
	const calls = respond('', 429, { 'retry-after': '60' });
	await expect(htmlFetch('https://www.linkedin.com/', signal())).rejects.toMatchObject({ code: 'rate-limited' });
	expect(calls()).toBe(1);
	const retryCalls = respond('', 503, { 'retry-after': '1' });
	await expect(htmlFetch('https://www.linkedin.com/', AbortSignal.timeout(10))).rejects.toMatchObject({
		code: 'timeout',
	});
	expect(retryCalls()).toBe(1);
});

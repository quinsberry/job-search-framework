import { afterEach, beforeEach, expect, test } from 'bun:test';
import { DecisionModelClient, type DecisionRequest } from '../decision-model';
import { matchJob } from '../match';
import { fixture } from './structured.test';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
	process.env.OPENROUTER_API_KEY = 'fictional-test-key';
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
	else process.env.OPENROUTER_API_KEY = originalKey;
});
const signal = () => new AbortController().signal;
const request: DecisionRequest = {
	context: 'Fictional vacancy evidence',
	questions: {
		role: { type: 'yes-no', text: 'Does it fit?' },
		seniority: { type: 'choice', text: 'Which seniority?', options: ['senior', 'unknown'] },
		skills: { type: 'scale', text: 'How many required skills?', min: 0, max: 100 },
	},
};
const body = () => ({
	model: 'fictional-response-model',
	answers: {
		role: { type: 'noul', noul: 0.8 },
		seniority: { type: 'choice', choice: 'senior', probabilities: { senior: 0.8, unknown: 0.2 }, confidence: 0.8 },
		skills: {
			type: 'score',
			score: 3,
			probabilities: { '0': 0, '1': 0, '2': 0, '3': 1, '4': 0 },
			legend: { '0': 'None', '1': 'Quarter', '2': 'Half', '3': 'Three quarters', '4': 'All' },
			confidence: 1,
		},
	},
	usage: { cost: 0.00003 },
});
function respond(make: () => Response | Promise<Response>) {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return make();
	}) as unknown as typeof fetch;
	return () => calls;
}

test('client maps neutral questions and responses, reports cost and bounds the actual wire body', async () => {
	let sent: Record<string, unknown> = {};
	globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
		expect(String(url)).toBe('https://openrouter.ai/api/v1/systemone');
		expect(options?.headers).toMatchObject({ Authorization: 'Bearer fictional-test-key' });
		expect(Buffer.byteLength(String(options?.body), 'utf8')).toBeLessThan(32000);
		sent = JSON.parse(String(options?.body));
		return Response.json(body());
	}) as typeof fetch;
	const model = new DecisionModelClient();
	const response = await model.decide(request, signal());
	expect(sent.state).toBe(request.context);
	expect(sent.questions).toMatchObject({
		role: { type: 'noul', instructions: 'Does it fit?' },
		seniority: { type: 'choice', criteria: { senior: null, unknown: null } },
		skills: { type: 'score' },
	});
	expect(response).toEqual({
		answers: {
			role: { probability: 0.8 },
			seniority: { probabilities: { senior: 0.8, unknown: 0.2 } },
			skills: { value: 75 },
		},
		costUsd: 0.00003,
	});
	const large = { ...request, context: '漢字😀'.repeat(5000) };
	await expect(model.decide(large, signal())).rejects.toMatchObject({ code: 'invalid-input' });
});

test('missing credentials and malformed inputs reject before any network request', async () => {
	const calls = respond(() => Response.json(body()));
	delete process.env.OPENROUTER_API_KEY;
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({ code: 'unavailable' });
	expect(calls()).toBe(0);
});

test('missing cost stays null and malformed responses cannot become decisions', async () => {
	const noCost = body();
	delete (noCost as { usage?: unknown }).usage;
	respond(() => Response.json(noCost));
	expect((await new DecisionModelClient().decide(request, signal())).costUsd).toBeNull();
	for (const mutate of [
		(value: ReturnType<typeof body>) => {
			value.answers.role.noul = 2;
		},
		(value: ReturnType<typeof body>) => {
			delete (value.answers as Record<string, unknown>).role;
		},
		(value: ReturnType<typeof body>) => {
			value.answers.seniority.probabilities.senior = 0.3;
		},
		(value: ReturnType<typeof body>) => {
			value.answers.skills.score = 4;
		},
		(value: ReturnType<typeof body>) => {
			value.usage.cost = -1;
		},
	]) {
		const malformed = body();
		mutate(malformed);
		const calls = respond(() => Response.json(malformed));
		await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
			code: 'invalid-response',
		});
		expect(calls()).toBe(1);
	}
	respond(() => new Response(new Uint8Array([0xff])));
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
		code: 'invalid-response',
	});
	respond(() => new Response('x'.repeat(256001)));
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
		code: 'invalid-response',
	});
	respond(() => new Response('not JSON'));
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
		code: 'invalid-response',
	});
	respond(() => new Response('oversized', { headers: { 'content-length': '300000' } }));
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
		code: 'invalid-response',
	});
});

test('HTTP failures and Retry-After cap map to typed operational errors', async () => {
	for (const status of [400, 401, 403]) {
		const calls = respond(() => new Response('', { status }));
		await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
			code: 'unavailable',
		});
		expect(calls()).toBe(1);
	}
	for (const retryAfter of ['60', new Date(Date.now() + 60000).toUTCString()]) {
		const calls = respond(() => new Response('', { status: 429, headers: { 'retry-after': retryAfter } }));
		await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({
			code: 'rate-limited',
		});
		expect(calls()).toBe(1);
	}
});

test('SDK honours short retry waits without a second retry loop and refuses long millisecond waits', async () => {
	const retries: (string | undefined)[] = [];
	globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => {
		retries.push(new Headers(options?.headers).get('X-TypeSafe-Retry-Count') ?? undefined);
		return retries.length === 1
			? new Response('', { status: 429, headers: { 'retry-after-ms': '1' } })
			: Response.json(body());
	}) as typeof fetch;
	expect((await new DecisionModelClient().decide(request, signal())).costUsd).toBe(0.00003);
	expect(retries).toEqual([undefined, '1']);
	const calls = respond(() => new Response('', { status: 503, headers: { 'retry-after-ms': '3000' } }));
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({ code: 'rate-limited' });
	expect(calls()).toBe(1);
});

test('transient HTTP errors retry, network failures stop after three attempts', async () => {
	let attempt = 0;
	const calls = respond(() => (++attempt < 3 ? new Response('', { status: 503 }) : Response.json(body())));
	expect((await new DecisionModelClient().decide(request, signal())).answers.role).toEqual({ probability: 0.8 });
	expect(calls()).toBe(3);
	const failures = respond(() => {
		throw new TypeError('Fictional connection loss');
	});
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({ code: 'network' });
	expect(failures()).toBe(3);
	const rateLimited = respond(() => new Response('', { status: 429 }));
	await expect(new DecisionModelClient().decide(request, signal())).rejects.toMatchObject({ code: 'rate-limited' });
	expect(rateLimited()).toBe(3);
});

test('cancellation covers before fetch, pending fetch, body reads and retry waits', async () => {
	const controller = new AbortController();
	controller.abort();
	const calls = respond(() => Response.json(body()));
	await expect(new DecisionModelClient().decide(request, controller.signal)).rejects.toMatchObject({
		code: 'cancelled',
	});
	expect(calls()).toBe(0);
	respond(async () => new Promise(() => {}));
	await expect(new DecisionModelClient().decide(request, AbortSignal.timeout(5))).rejects.toMatchObject({
		code: 'timeout',
	});
	respond(
		() =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{'));
					},
				}),
			),
	);
	await expect(new DecisionModelClient().decide(request, AbortSignal.timeout(5))).rejects.toMatchObject({
		code: 'timeout',
	});
	const retryCalls = respond(() => new Response('', { status: 503, headers: { 'retry-after': '1' } }));
	await expect(new DecisionModelClient().decide(request, AbortSignal.timeout(5))).rejects.toMatchObject({
		code: 'timeout',
	});
	expect(retryCalls()).toBe(1);
});

test('one decision client remains usable after a cancelled or guarded request', async () => {
	const model = new DecisionModelClient();
	const controller = new AbortController();
	controller.abort();
	await expect(model.decide(request, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
	respond(() => new Response('', { status: 429, headers: { 'retry-after': '60' } }));
	await expect(model.decide(request, signal())).rejects.toMatchObject({ code: 'rate-limited' });
	respond(() => Response.json(body()));
	expect((await model.decide(request, signal())).costUsd).toBe(0.00003);
});

test('large multi-byte vacancy text is bounded through the full matching and HTTP path', async () => {
	const { job, ...criteria } = fixture();
	job.description = '😀漢字\n"'.repeat(18000);
	let bytes = 0;
	globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => {
		bytes = Buffer.byteLength(String(options?.body), 'utf8');
		const sent = JSON.parse(String(options?.body)) as {
			questions: Record<string, { type: 'noul' | 'choice'; criteria?: Record<string, null> }>;
		};
		return Response.json({
			model: 'fictional-model',
			usage: { cost: 0.00004 },
			answers: Object.fromEntries(
				Object.entries(sent.questions).map(([id, question]) => {
					if (question.type === 'noul') return [id, { type: 'noul', noul: 1 }];
					const options = Object.keys(question.criteria!);
					return [
						id,
						{
							type: 'choice',
							choice: options[0],
							confidence: 1,
							probabilities: Object.fromEntries(
								options.map((option, index) => [option, index === 0 ? 1 : 0]),
							),
						},
					];
				}),
			),
		});
	}) as typeof fetch;
	const result = await matchJob(job, criteria, { model: new DecisionModelClient() }, signal());
	expect(bytes).toBeGreaterThan(25000);
	expect(bytes).toBeLessThan(32000);
	expect(result.outcome).toBe('needs-clarification');
	expect(result.costUsd).toBe(0.00004);
});

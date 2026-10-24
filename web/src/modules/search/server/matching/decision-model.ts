import { z } from 'zod';
import {
	APIConnectionError,
	APIError,
	APITimeoutError,
	APIUserAbortError,
	TypeSafeClient,
	choice,
	noul,
	score,
} from '@typesafe-ai/sdk';

export const matchErrorCodeSchema = z.enum([
	'invalid-input',
	'unavailable',
	'rate-limited',
	'timeout',
	'network',
	'invalid-response',
	'cancelled',
]);
export class MatchError extends Error {
	constructor(
		public readonly code: z.infer<typeof matchErrorCodeSchema>,
		message: string,
	) {
		super(message);
		this.name = 'MatchError';
	}
}
const text = z.string().trim().min(1).max(1000000);
const key = z.string().min(1).max(100);
const probability = z.number().min(0).max(1);
export const questionSchema = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('yes-no'), text }),
	z.strictObject({
		type: z.literal('choice'),
		text,
		options: z
			.array(z.string().min(1).max(100))
			.min(2)
			.max(20)
			.refine((options) => new Set(options).size === options.length),
	}),
	z.strictObject({ type: z.literal('scale'), text, min: z.literal(0), max: z.literal(100) }),
]);
export const answerSchema = z.union([
	z.strictObject({ probability }),
	z.strictObject({
		probabilities: z
			.record(key, probability)
			.refine(
				(items) =>
					Object.keys(items).length >= 2 &&
					Object.keys(items).length <= 20 &&
					Math.abs(Object.values(items).reduce((a, b) => a + b, 0) - 1) <= 0.0001,
			),
	}),
	z.strictObject({ value: z.number().min(0).max(100) }),
]);
export const decisionRequestSchema = z.strictObject({
	context: text,
	questions: z
		.record(key, questionSchema)
		.refine((items) => Object.keys(items).length >= 1 && Object.keys(items).length <= 8),
});
export const decisionResponseSchema = z.strictObject({
	answers: z.record(key, answerSchema),
	costUsd: z.number().nonnegative().nullable(),
	// The model the provider says answered, when it says; it can differ from the one requested.
	model: z.string().trim().min(1).max(200).optional(),
});
export type Question = z.infer<typeof questionSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;
// The requested model ID: the first part of a client identity.
export const requestedModel = (identity: string) => identity.split(';')[0];
export interface DecisionModel {
	// Changes whenever anything that affects how the model judges changes; part of the criteria digest.
	readonly identity: string;
	readonly maxInputBytes: number;
	decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
}
export function checkSignal(signal: AbortSignal): void {
	if (signal.aborted)
		throw new MatchError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', 'Matching stopped');
}
export async function withCancellation<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	let abort: () => void = () => {};
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				abort = () => {
					try {
						checkSignal(signal);
					} catch (error) {
						reject(error);
					}
				};
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) abort();
			}),
		]);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}
export function validateAnswers(request: DecisionRequest, value: unknown): DecisionResponse {
	const parsed = decisionResponseSchema.safeParse(value);
	if (!parsed.success) throw new MatchError('invalid-response', 'Malformed decision response');
	const response = parsed.data;
	if (Object.keys(response.answers).length !== Object.keys(request.questions).length)
		throw new MatchError('invalid-response', 'Decision answer count does not match questions');
	for (const [id, question] of Object.entries(request.questions)) {
		const answer = response.answers[id];
		if (
			!answer ||
			(question.type === 'yes-no' && !('probability' in answer)) ||
			(question.type === 'scale' && !('value' in answer)) ||
			(question.type === 'choice' &&
				(!('probabilities' in answer) ||
					Object.keys(answer.probabilities).length !== question.options.length ||
					question.options.some((option) => !(option in answer.probabilities))))
		)
			throw new MatchError('invalid-response', 'Decision answer does not match its question');
	}
	return response;
}

// System One wire shapes: https://openrouter.ai/docs/guides/community/typesafe-sdk
// Score is an expected level index (0–4), mapped here to a percentage (0–100).
const scoreLevels = [
	'None of the required skills',
	'About one quarter of the required skills',
	'About half of the required skills',
	'About three quarters of the required skills',
	'All required skills',
];
const distribution = z.record(z.string(), probability);
const wireAnswerSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('noul'), noul: probability }),
	z.object({ type: z.literal('choice'), choice: z.string(), probabilities: distribution, confidence: probability }),
	z.object({
		type: z.literal('score'),
		score: z.number().min(0).max(4),
		legend: z.record(z.string(), z.string()),
		probabilities: distribution,
		confidence: probability,
	}),
]);
const wireResponseSchema = z.object({
	model: z.string().min(1),
	answers: z.record(key, wireAnswerSchema),
	usage: z.object({ cost: z.number().nonnegative().nullish() }).optional(),
});
const MODEL_ID = 'typesafe/jev-1.14';
const MAX_INPUT_BYTES = 28000;
// Bump when question encoding or score mapping changes, so rejections judged the old way are judged again.
const FORMAT_VERSION = 1;
const MAX_RESPONSE_BYTES = 256000;

// The SDK buffers bodies without a size cap and falls back to backoff for long Retry-After.
function guardedFetch(stop: AbortController): TypeSafeClient['fetch'] {
	return async (url, init) => {
		const signal = init!.signal!;
		const fail = (code: 'invalid-response' | 'rate-limited', message: string): never => {
			const error = new MatchError(code, message);
			stop.abort(error);
			throw error;
		};
		const response = await withCancellation(fetch(url, { ...init, redirect: 'error' }), signal);
		const retryAfter = response.headers.get('retry-after');
		const retryAfterMs = response.headers.get('retry-after-ms');
		const seconds = Number(retryAfter);
		const delay =
			retryAfterMs !== null && Number.isFinite(Number(retryAfterMs)) && Number(retryAfterMs) >= 0
				? Number(retryAfterMs)
				: retryAfter === null
					? 0
					: Number.isFinite(seconds)
						? seconds * 1000
						: Date.parse(retryAfter) - Date.now();
		if ((response.status === 429 || response.status >= 500) && delay > 2000) {
			void response.body?.cancel().catch(() => {});
			fail('rate-limited', 'Decision model retry wait exceeds its limit');
		}
		if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
			void response.body?.cancel().catch(() => {});
			fail('invalid-response', 'Decision response is too large');
		}
		if (!response.body) return response;
		let size = 0;
		const decoder = new TextDecoder('utf-8', { fatal: true });
		const body = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					size += chunk.byteLength;
					if (size > MAX_RESPONSE_BYTES) fail('invalid-response', 'Decision response is too large');
					try {
						decoder.decode(chunk, { stream: true });
					} catch {
						fail('invalid-response', 'Decision response encoding is invalid');
					}
					controller.enqueue(chunk);
				},
				flush() {
					try {
						decoder.decode();
					} catch {
						fail('invalid-response', 'Decision response encoding is invalid');
					}
				},
			}),
		);
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}

export class DecisionModelClient implements DecisionModel {
	readonly identity = `${MODEL_ID};input=${MAX_INPUT_BYTES};format=${FORMAT_VERSION}`;
	readonly maxInputBytes = MAX_INPUT_BYTES;

	async decide(value: DecisionRequest, callerSignal: AbortSignal): Promise<DecisionResponse> {
		checkSignal(callerSignal);
		const parsed = decisionRequestSchema.safeParse(value);
		if (!parsed.success || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_INPUT_BYTES)
			throw new MatchError('invalid-input', 'Decision input exceeds its budget or is malformed');
		const request = parsed.data;
		const apiKey = process.env.OPENROUTER_API_KEY?.trim();
		if (!apiKey) throw new MatchError('unavailable', 'Decision model credentials are missing');
		const questions = Object.fromEntries(
			Object.entries(request.questions).map(([id, question]) => [
				id,
				question.type === 'yes-no'
					? noul(question.text)
					: question.type === 'choice'
						? choice(question.text, Object.fromEntries(question.options.map((option) => [option, null])))
						: score(question.text, scoreLevels),
			]),
		);
		const body = JSON.stringify({ model: MODEL_ID, state: request.context, questions });
		if (Buffer.byteLength(body, 'utf8') > 32000)
			throw new MatchError('invalid-input', 'Decision request envelope exceeds its budget');
		const stop = new AbortController();
		const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(30000), stop.signal]);
		const client = new TypeSafeClient({
			apiKey,
			baseURL: 'https://openrouter.ai/api',
			compression: false,
			logLevel: 'off',
			timeout: 30000,
			retry: {
				maxRetries: 2,
				backoffInitialMs: 250,
				backoffMaxMs: 2000,
				backoffJitter: 0,
				maxRetryAfterMs: 2000,
				httpStatuses: new Set([429, ...Array.from({ length: 100 }, (_, index) => 500 + index)]),
			},
			fetch: guardedFetch(stop),
		});
		try {
			const wire = wireResponseSchema.safeParse(
				await withCancellation(
					client.systemOne({ model: MODEL_ID, state: request.context, questions }, { signal }),
					signal,
				),
			);
			if (!wire.success) throw new MatchError('invalid-response', 'Malformed decision response');
			const answers: DecisionResponse['answers'] = {};
			for (const [id, answer] of Object.entries(wire.data.answers)) {
				const question = request.questions[id];
				if (
					!question ||
					(question.type === 'yes-no'
						? answer.type !== 'noul'
						: question.type === 'choice'
							? answer.type !== 'choice'
							: answer.type !== 'score')
				)
					throw new MatchError('invalid-response', 'Unexpected decision answer type');
				if (answer.type === 'score') {
					const keys = scoreLevels.map((_, index) => String(index));
					if (
						Object.keys(answer.probabilities).length !== keys.length ||
						keys.some((key) => !(key in answer.probabilities) || !(key in answer.legend)) ||
						Math.abs(Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.0001 ||
						Math.abs(
							keys.reduce((sum, key) => sum + Number(key) * answer.probabilities[key], 0) - answer.score,
						) > 0.001
					)
						throw new MatchError('invalid-response', 'Malformed decision scale');
				}
				if (answer.type === 'choice' && !(answer.choice in answer.probabilities))
					throw new MatchError('invalid-response', 'Malformed decision choice');
				answers[id] =
					answer.type === 'noul'
						? { probability: answer.noul }
						: answer.type === 'choice'
							? { probabilities: answer.probabilities }
							: { value: answer.score * 25 };
			}
			return validateAnswers(request, {
				answers,
				costUsd: wire.data.usage?.cost ?? null,
				model: wire.data.model,
			});
		} catch (error) {
			if (stop.signal.aborted) throw stop.signal.reason;
			checkSignal(signal);
			if (error instanceof MatchError) throw error;
			if (error instanceof APITimeoutError) throw new MatchError('timeout', 'Decision model timed out');
			if (error instanceof APIUserAbortError) throw new MatchError('cancelled', 'Matching stopped');
			if (error instanceof APIConnectionError) throw new MatchError('network', 'Decision model request failed');
			if (error instanceof APIError)
				throw new MatchError(
					error.status === 429 ? 'rate-limited' : 'unavailable',
					error.status === 401 || error.status === 403
						? `Decision model rejected the API key (HTTP ${error.status}); OPENROUTER_API_KEY must be a regular OpenRouter key, not a management key`
						: `Decision model request failed (HTTP ${error.status})`,
				);
			throw new MatchError('unavailable', 'Decision model failed');
		}
	}
}

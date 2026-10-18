import { z } from 'zod';
export class RequestError extends Error {
	constructor(
		message: string,
		public code: string,
	) {
		super(message);
	}
}
export async function request<T>(url: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		signal,
		headers: input instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
		body: input instanceof FormData ? input : JSON.stringify(input),
	});
	const data: unknown = await response.json();
	if (!response.ok) {
		const error = z.object({ error: z.string(), code: z.string() }).parse(data);
		throw new RequestError(error.error, error.code);
	}
	return schema.parse(data);
}

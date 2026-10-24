import { z } from 'zod';
// True when the browser addressed a loopback host and the caller is that same origin.
// Judges the Host header: `next start` builds request.url from its own hostname, not the browser's.
export function isLocalRequest(headers: Headers): boolean {
	const host = headers.get('host') ?? '';
	if (!URL.canParse(`http://${host}`)) return false;
	return (
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname) &&
		[`http://${host}`, `https://${host}`].includes(headers.get('origin') ?? '')
	);
}
// Rejects non-local callers and reads a bounded body; throws coded errors for `errorResponse`.
export async function readLocalBody(request: Request): Promise<Response> {
	if (!isLocalRequest(request.headers)) {
		throw Object.assign(new Error('Operations are only available from the local app.'), { code: 'forbidden' });
	}
	// Bound the stream before parsing multipart data; Content-Length is not trusted.
	const reader = request.body?.getReader();
	if (!reader) throw new Error('Request body is required.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 10 * 1024 * 1024 + 64 * 1024) {
				await reader.cancel();
				throw new Error('Request exceeds the 10 MiB upload limit.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return new Response(new Blob(chunks as BlobPart[]), {
		headers: { 'content-type': request.headers.get('content-type') ?? '' },
	});
}
export function errorResponse(error: unknown) {
	const code = error instanceof Error && 'code' in error ? String(error.code) : 'invalid';
	const message =
		error instanceof z.ZodError
			? error.issues.map((i) => `${i.path.join('.') || 'Request'}: ${i.message}`).join('; ')
			: error instanceof Error
				? error.message
				: 'Request failed.';
	return Response.json(
		{ error: message, code },
		{
			status:
				code === 'forbidden'
					? 403
					: code === 'not-found'
						? 404
						: code === 'conflict'
							? 409
							: code === 'unavailable'
								? 503
								: 400,
		},
	);
}
export async function localRequest(request: Request, operation: (body: Response) => Promise<unknown>) {
	try {
		const body = await readLocalBody(request);
		return Response.json(await operation(body), {
			headers: { 'Cache-Control': 'no-store' },
		});
	} catch (error) {
		return errorResponse(error);
	}
}

import { z } from 'zod';
export async function localRequest(request: Request, operation: (body: Response) => Promise<unknown>) {
	try {
		const url = new URL(request.url);
		if (
			!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
			request.headers.get('host') !== url.host ||
			request.headers.get('origin') !== url.origin
		) {
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
		const body = new Response(new Blob(chunks as BlobPart[]), {
			headers: { 'content-type': request.headers.get('content-type') ?? '' },
		});
		return Response.json(await operation(body), { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? String(error.code) : 'invalid';
		const message =
			error instanceof z.ZodError
				? error.issues.map((i) => `${i.path.join('.') || 'Request'}: ${i.message}`).join('; ')
				: error instanceof Error
					? error.message
					: 'Request failed.';
		return Response.json(
			{ error: message, code },
			{ status: code === 'forbidden' ? 403 : code === 'conflict' ? 409 : code === 'unavailable' ? 503 : 400 },
		);
	}
}

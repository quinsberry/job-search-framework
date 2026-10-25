import { setTimeout as wait } from 'node:timers/promises';
import { cancellationError, SearchSourceError } from '../../contracts';

const MAX_BYTES = 2 * 1024 * 1024;
async function readBody(response: Response, signal: AbortSignal): Promise<string> {
	if (Number(response.headers.get('content-length')) > MAX_BYTES) {
		await response.body?.cancel();
		throw new SearchSourceError('invalid-response', 'LinkedIn response is too large');
	}
	const reader = response.body?.getReader();
	if (!reader) throw new SearchSourceError('invalid-response', 'Missing LinkedIn response body');
	const chunks: Uint8Array[] = [];
	let size = 0;
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener('abort', abort, { once: true });
	try {
		while (true) {
			signal.throwIfAborted();
			const { value, done } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BYTES) throw new SearchSourceError('invalid-response', 'LinkedIn response is too large');
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		return new TextDecoder().decode(bytes);
	} finally {
		signal.removeEventListener('abort', abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export async function htmlFetch(url: string, runSignal: AbortSignal): Promise<string> {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (runSignal.aborted) throw cancellationError(runSignal);
		const signal = AbortSignal.any([runSignal, AbortSignal.timeout(10000)]);
		let delay = 250 * 2 ** attempt;
		try {
			const response = await fetch(url, {
				headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
				signal,
				redirect: 'manual',
			});
			if (!response.ok) {
				await response.body?.cancel();
				if (response.status === 404) throw new SearchSourceError('not-found', 'LinkedIn job not found');
				if ([401, 403, 999].includes(response.status) || (response.status >= 300 && response.status < 400))
					throw new SearchSourceError('blocked', 'LinkedIn requires access verification');
				if (response.status !== 429 && response.status < 500)
					throw new SearchSourceError('unavailable', 'LinkedIn request failed');
				const retryAfter = response.headers.get('retry-after');
				if (retryAfter !== null) {
					const seconds = Number(retryAfter);
					const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
					if (Number.isFinite(requested)) delay = Math.max(delay, requested);
				}
				if (delay > 2000 || attempt === 2)
					throw new SearchSourceError(
						delay > 2000 || response.status === 429 ? 'rate-limited' : 'unavailable',
						'LinkedIn retries exhausted',
					);
			} else {
				return await readBody(response, signal);
			}
		} catch (error) {
			if (runSignal.aborted) throw cancellationError(runSignal);
			if (error instanceof SearchSourceError) throw error;
			if (attempt === 2)
				throw new SearchSourceError(signal.aborted ? 'timeout' : 'network', 'LinkedIn request failed');
		}
		try {
			await wait(delay, undefined, { signal: runSignal });
		} catch {
			throw cancellationError(runSignal);
		}
	}
	throw new SearchSourceError('unavailable', 'LinkedIn retries exhausted');
}

export function checkAccess(html: string): void {
	if (
		/<title[^>]*>[^<]*(?:sign in|log in|security verification)|(?:class|id)=["'][^"']*(?:authwall|challenge-page|captcha|login-form|consent-page)|<form[^>]*action=["'][^"']*(?:checkpoint|authwall)|<iframe[^>]*src=["'][^"']*(?:recaptcha|hcaptcha)/i.test(
			html,
		)
	)
		throw new SearchSourceError('blocked', 'LinkedIn returned an access wall');
}

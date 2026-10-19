import {
	jobDetailSchema,
	jobRefSchema,
	SearchSourceError,
	sourceFailure,
	type DetailResult,
	type JobRef,
} from '../../contracts';
import { parseJobDetail } from './helpers';
import { checkAccess, htmlFetch } from './http';
import { summary } from './search';

export function validateReference(value: JobRef): JobRef {
	const result = jobRefSchema.safeParse(value);
	if (!result.success) throw new SearchSourceError('invalid-input', 'Invalid LinkedIn reference');
	const ref = result.data;
	const url = new URL(ref.url);
	const pathId = url.pathname.match(/^\/jobs\/view\/(?:[^/]+-)?(\d{6,20})\/?$/)?.[1];
	if (
		ref.sourceId !== 'linkedin' ||
		!/^\d{6,20}$/.test(ref.sourceJobId) ||
		!['www.linkedin.com', 'linkedin.com'].includes(url.hostname) ||
		url.port ||
		pathId !== ref.sourceJobId
	)
		throw new SearchSourceError('invalid-input', 'LinkedIn reference identity does not match its URL');
	return ref;
}

export async function runDetail(value: JobRef, signal: AbortSignal): Promise<DetailResult> {
	const ref = validateReference(value);
	try {
		const html = await htmlFetch(
			`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${ref.sourceJobId}`,
			signal,
		);
		checkAccess(html);
		const parsed = parseJobDetail(html, ref.sourceJobId);
		if (!parsed.title || !parsed.description)
			throw new SearchSourceError('invalid-response', 'Missing LinkedIn vacancy content');
		let facts;
		try {
			facts = summary(parsed, new Date().toISOString());
		} catch {
			throw new SearchSourceError('invalid-response', 'Malformed LinkedIn summary facts');
		}
		const result = jobDetailSchema.safeParse({
			...facts,
			description: parsed.description,
			availability: parsed.isActive ? 'unknown' : 'closed',
			advertisedFacts: {
				workArrangements: null,
				workArrangementsText: null,
				seniorityText: parsed.seniority,
				employmentText: parsed.employmentType,
				skills: null,
				expiresAt: null,
				compensation: null,
			},
		});
		if (!result.success) throw new SearchSourceError('invalid-response', 'Malformed LinkedIn detail facts');
		return { ok: true, job: result.data };
	} catch (error) {
		if (signal.aborted) throw error;
		return { ok: false, ref, error: sourceFailure(error) };
	}
}

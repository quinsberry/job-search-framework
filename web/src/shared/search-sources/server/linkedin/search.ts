import { z } from 'zod';
import {
	adapterSearchInputSchema,
	jobSummarySchema,
	SearchSourceError,
	type DiscoveryQuery,
	type JobSummary,
	type SourcePage,
} from '../../contracts';
import { parseJobCards, type JobCard } from './helpers';
import { checkAccess, htmlFetch } from './http';

const cursorSchema = z.strictObject({
	start: z.number().int().min(0).max(1000000),
	pending: z.array(jobSummarySchema).max(100),
});
export const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

export function discoveryRequest(query: DiscoveryQuery, start: number, now = Date.now()) {
	const params = new URLSearchParams({ keywords: query.query, start: String(start) });
	const filters: SourcePage['filters'] = [];
	if (query.location) {
		params.set('location', query.location);
		filters.push({
			filter: 'location',
			application: 'approximate',
			message: 'LinkedIn interprets the workplace location hint',
		});
	}
	// The guest endpoint returns identical results for every f_WT value (checked 2026-10-23), so it is not sent.
	if (query.workArrangements)
		filters.push({
			filter: 'workArrangements',
			application: 'unsupported',
			message: 'LinkedIn guest search ignores workplace filters; matching checks arrangements',
		});
	if (query.publishedAfter) {
		params.set('f_TPR', `r${Math.max(1, Math.ceil((now - Date.parse(query.publishedAfter)) / 1000))}`);
		filters.push({
			filter: 'publishedAfter',
			application: 'approximate',
			message: 'Absolute cutoff translated to a rounded relative age window; verify publication evidence',
		});
	}
	return { url: `${SEARCH_URL}?${params}`, filters };
}

export function summary(card: JobCard, observedAt: string): JobSummary {
	return jobSummarySchema.parse({
		sourceId: 'linkedin',
		sourceJobId: card.id,
		url: `https://www.linkedin.com/jobs/view/${card.id}`,
		title: card.title,
		company: card.company || card.companyUrl ? { name: card.company, url: card.companyUrl } : null,
		locations: card.location ? [{ label: card.location, city: null, country: null }] : [],
		publishedAt: card.date,
		observedAt,
	});
}

export async function runSearch(
	value: z.infer<typeof adapterSearchInputSchema>,
	signal: AbortSignal,
): Promise<SourcePage> {
	const input = adapterSearchInputSchema.safeParse(value);
	if (!input.success) throw new SearchSourceError('invalid-input', 'Invalid LinkedIn search input');
	const { query, limit, cursor } = input.data;
	let state = { start: 0, pending: [] as JobSummary[] };
	if (cursor) {
		let parsed: z.infer<typeof cursorSchema>;
		try {
			parsed = cursorSchema.parse(JSON.parse(cursor));
		} catch {
			throw new SearchSourceError('invalid-input', 'Invalid LinkedIn cursor');
		}
		if (parsed.pending.some((job) => job.sourceId !== 'linkedin' || !/^\d{6,20}$/.test(job.sourceJobId)))
			throw new SearchSourceError('invalid-input', 'Invalid LinkedIn cursor identities');
		state = parsed;
	}
	if (signal.aborted) throw new SearchSourceError('cancelled', 'LinkedIn search stopped');
	const request = discoveryRequest(query, state.start);
	if (!state.pending.length) {
		const html = await htmlFetch(request.url, signal);
		checkAccess(html);
		const cards = parseJobCards(html);
		if (cards.length > 100) throw new SearchSourceError('invalid-response', 'LinkedIn native page is too large');
		if (!cards.length) {
			if (html.trim() && !/class=["'][^"']*jobs-search-no-results/i.test(html))
				throw new SearchSourceError('invalid-response', 'Missing LinkedIn search structure');
			return { jobs: [], nextCursor: null, filters: request.filters };
		}
		try {
			state.pending = cards.map((card) => summary(card, new Date().toISOString()));
		} catch {
			throw new SearchSourceError('invalid-response', 'Malformed LinkedIn search facts');
		}
		state.start += cards.length;
	}
	const jobs = state.pending.splice(0, limit);
	const nextCursor = JSON.stringify(state);
	if (nextCursor.length > 100000)
		throw new SearchSourceError('invalid-response', 'LinkedIn continuation is too large');
	return { jobs, nextCursor, filters: request.filters };
}

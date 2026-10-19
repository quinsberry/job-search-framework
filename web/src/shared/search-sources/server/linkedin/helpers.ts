import { SearchSourceError } from '../../contracts';

export interface JobCard {
	id: string;
	title: string;
	company: string | null;
	companyUrl: string | null;
	location: string | null;
	date: string | null;
	url: string;
}

export interface JobDetail extends JobCard {
	description: string | null;
	seniority: string | null;
	employmentType: string | null;
	jobFunction: string | null;
	industries: string | null;
	isActive: boolean;
}

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth.
 */
export function extractDivContent(html: string, className: string): string | null {
	const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, 'i');
	const open = openRe.exec(html);
	if (!open) return null;

	let i = open.index + open[0].length;
	let depth = 1;

	while (depth > 0 && i < html.length) {
		const nextOpen = html.indexOf('<div', i);
		const nextClose = html.indexOf('</div>', i);

		if (nextClose === -1) return null;

		if (nextOpen !== -1 && nextOpen < nextClose) {
			depth++;
			i = nextOpen + 4;
		} else {
			depth--;
			i = nextClose + 6;
		}
	}

	return html.slice(open.index + open[0].length, i - 6);
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
	return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

function decodeHtmlEntities(text: string): string {
	return (
		text
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&apos;/g, "'")
			// Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
			.replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
			.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
			.replace(/&nbsp;/g, ' ')
	);
}

function stripTags(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function clean(html: string): string {
	return decodeHtmlEntities(stripTags(html));
}

/**
 * Parse the search response: a flat list of <li> job cards. We split on the
 * job-posting URN and parse each chunk independently so one malformed card
 * cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
	const results: JobCard[] = [];
	const chunks = html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1);

	for (const chunk of chunks) {
		const idMatch = chunk.match(/^(\d{6,20})"/);
		if (!idMatch) throw new SearchSourceError('invalid-response', 'Malformed LinkedIn identity');
		const id = idMatch[1];

		// Full link + title (title lives in the sr-only span or the <h3> title).
		const linkMatch = chunk.match(/class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/i);
		const url = linkMatch ? decodeHtmlEntities(linkMatch[1]).split('?')[0] : '';

		let title: string | null = null;
		const h3 = chunk.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/i);
		if (h3) title = clean(h3[1]);
		if (!title) {
			const sr = chunk.match(/class="sr-only"[^>]*>([\s\S]*?)<\/span>/i);
			if (sr) title = clean(sr[1]);
		}
		if (!title) throw new SearchSourceError('invalid-response', 'Malformed LinkedIn card');

		// Company (subtitle <h4> with optional inner <a>).
		let company: string | null = null;
		let companyUrl: string | null = null;
		const sub = chunk.match(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/i);
		if (sub) {
			const a = sub[1].match(/href="([^"]+)"/i);
			if (a) companyUrl = decodeHtmlEntities(a[1]).split('?')[0];
			company = clean(sub[1]) || null;
		}

		// Location + date.
		const loc = chunk.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/i);
		const location = loc ? clean(loc[1]) || null : null;
		const dt = chunk.match(/class="job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"/i);
		const date = dt ? dt[1] : null;

		results.push({
			id,
			title,
			company,
			companyUrl,
			location,
			date,
			url: url || `https://www.linkedin.com/jobs/view/${id}`,
		});
	}

	return results;
}

/** Parse the single-job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
	const title = html.match(/class="(?:top-card-layout__title|topcard__title)[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i)?.[1];
	const orgMatch = html.match(/class="topcard__org-name-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
	const company = orgMatch ? clean(orgMatch[2]) || null : null;
	const companyUrl = orgMatch ? decodeHtmlEntities(orgMatch[1]).split('?')[0] : null;

	const locMatch = html.match(/class="topcard__flavor topcard__flavor--bullet"[^>]*>([\s\S]*?)<\/span>/i);
	const location = locMatch ? clean(locMatch[1]) || null : null;

	// Rich description block. Keep paragraph/line breaks as newlines.
	let description: string | null = null;
	const descHtml =
		extractDivContent(html, 'show-more-less-html__markup') ?? extractDivContent(html, 'description__text');
	if (descHtml) {
		const withBreaks = descHtml.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|ul|ol|div|h\d)>/gi, '\n');
		description =
			decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' ').replace(/[^\S\n]+/g, ' '))
				.replace(/\n{3,}/g, '\n\n')
				.trim() || null;
	}

	// Job-criteria items: subheader label -> text value.
	const criteria: Record<string, string> = {};
	const itemRe =
		/class="description__job-criteria-subheader"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?class="description__job-criteria-text[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
	let cm: RegExpExecArray | null;
	while ((cm = itemRe.exec(html)) !== null) {
		criteria[clean(cm[1]).toLowerCase()] = clean(cm[2]);
	}

	// Scope closure evidence to the top card; description boilerplate can quote it.
	const descStart = html.search(/class="(?:show-more-less-html__markup|description__text)/i);
	const topcard = descStart === -1 ? html : html.slice(0, descStart);
	const isActive = !/closed-job__flavor|no longer accepting applications/i.test(topcard);

	return {
		id,
		title: title ? clean(title) : '',
		company,
		companyUrl,
		location,
		date: html.match(/<time(?=[^>]*class="[^"]*posted-time)[^>]*datetime="([^"]+)"/i)?.[1] ?? null,
		url: `https://www.linkedin.com/jobs/view/${id}`,
		description,
		seniority: criteria['seniority level'] ?? null,
		employmentType: criteria['employment type'] ?? null,
		jobFunction: criteria['job function'] ?? null,
		industries: criteria['industries'] ?? null,
		isActive,
	};
}

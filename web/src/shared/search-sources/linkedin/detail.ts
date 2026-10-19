import { DETAIL_URL, htmlFetch, parseJobDetail } from './helpers';

export interface DetailOpts {
    id: string;
}

/** Accept a raw job ID, a job-view URL, or a job URN. */
export function normalizeId(input: string): string | null {
    const urn = input.match(/urn:li:jobPosting:(\d+)/);
    if (urn) return urn[1];
    const url = input.match(/-(\d{6,})(?:[\/?]|$)/) || input.match(/\/(\d{6,})(?:[\/?]|$)/);
    if (url) return url[1];
    const bare = input.match(/^\d{6,}$/);
    if (bare) return input;
    return null;
}

export async function runDetail(opts: DetailOpts) {
    const id = normalizeId(opts.id);
    if (!id) {
        throw new Error(`Could not parse a job ID from "${opts.id}"`);
    }
    try {
        const html = await htmlFetch(`${DETAIL_URL}/${id}`);
        if (!html) {
            throw new Error('Job not found');
        }
        const job = parseJobDetail(html, id);

        return JSON.stringify(job, null, 2);
    } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
    }
}

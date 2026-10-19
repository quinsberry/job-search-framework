import {
    SEARCH_URL,
    htmlFetch,
    parseJobCards,
    jobageToTPR,
    minutesToTPR,
    workTypeFlag,
    type WorkType,
} from './helpers';

export interface SearchOptions {
    query?: string;
    location: string;
    jobage: number;
    jobageMinutes?: number;
    remote?: WorkType;
    page: number;
    limit?: number;
}

function buildUrl(opts: SearchOptions): string {
    const params = new URLSearchParams();
    if (opts.query) params.set('keywords', opts.query);
    if (opts.location) params.set('location', opts.location);
    const tpr = opts.jobageMinutes !== undefined ? minutesToTPR(opts.jobageMinutes) : jobageToTPR(opts.jobage);
    if (tpr) params.set('f_TPR', tpr);
    if (opts.remote) params.set('f_WT', workTypeFlag(opts.remote));
    params.set('start', String((opts.page - 1) * 10));
    return `${SEARCH_URL}?${params.toString()}`;
}

export async function runSearch(opts: SearchOptions) {
    try {
        const html = await htmlFetch(buildUrl(opts));
        let cards = parseJobCards(html);
        if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit);

        return JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2);
    } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
    }
}

import type { SearchSourceAdapter } from '../../contracts';
import { runDetail } from './detail';
import { runSearch } from './search';

export const linkedinProvider = {
	descriptor: {
		id: 'linkedin',
		name: 'LinkedIn',
		supportedFilters: ['location', 'publishedAfter'],
	},
	search: runSearch,
	getDetail: runDetail,
} satisfies SearchSourceAdapter;

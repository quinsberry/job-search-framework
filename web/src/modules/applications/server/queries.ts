import type { DiscoveryQuery } from '@/domain/search-sources/contracts';
import type { SearchPreferences } from '@/domain/matching/criteria';

export function discoveryQueries(preferences: SearchPreferences): DiscoveryQuery[] {
	const { positionTitles, location, workArrangements } = preferences.targetPosition;
	// A remote job listed in another city is still acceptable, so remote searches only narrow by country.
	const place = workArrangements.includes('remote')
		? location?.country
		: [location?.city, location?.country].filter(Boolean).join(', ') || undefined;
	return [...new Set(positionTitles)].map((query) => ({
		query,
		workArrangements,
		...(place ? { location: place } : {}),
	}));
}

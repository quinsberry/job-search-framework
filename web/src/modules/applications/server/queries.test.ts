import { expect, test } from 'bun:test';
import type { SearchPreferences } from '@/modules/search/model/schema';
import { discoveryQueries } from './queries';

function preferences(workArrangements: SearchPreferences['targetPosition']['workArrangements']): SearchPreferences {
	return {
		targetPosition: {
			positionTitles: ['Engineer', 'Developer', 'Engineer'],
			seniority: ['senior'],
			positionType: ['full-time'],
			workArrangements,
			location: { city: 'Warsaw', country: 'Poland' },
			salaryRange: [],
		},
		settings: { maxJobsToProcess: 10, maxJobsToMatch: 5 },
	};
}

test('one query per distinct title; remote searches narrow by country, local ones by city', () => {
	expect(discoveryQueries(preferences(['remote', 'hybrid']))).toEqual([
		{ query: 'Engineer', workArrangements: ['remote', 'hybrid'], location: 'Poland' },
		{ query: 'Developer', workArrangements: ['remote', 'hybrid'], location: 'Poland' },
	]);
	expect(discoveryQueries(preferences(['hybrid', 'on-site']))[0].location).toBe('Warsaw, Poland');
	const noResidence = preferences(['remote']);
	delete noResidence.targetPosition.location;
	expect(discoveryQueries(noResidence)[0]).not.toHaveProperty('location');
});

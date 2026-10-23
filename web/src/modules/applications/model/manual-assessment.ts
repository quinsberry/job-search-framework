import { workArrangementSchema } from '@/shared/search-sources/contracts';
import { matchOutcome } from '@/shared/match-outcome';
import type { Assessment, SearchApplication } from './contracts';

export type SalaryMinimum = { min: number; currency: string; period: string; contractType: string };

// Original evidence stays intact; only this projection applies the job seeker's resolutions.
export function assessApplication(application: SearchApplication, bands: readonly SalaryMinimum[]): Assessment {
	const { match, expectedSalary, workArrangementOverride } = application;
	const salaryMet =
		expectedSalary !== null &&
		typeof expectedSalary === 'object' &&
		bands.some(
			(band) =>
				band.currency === expectedSalary.currency &&
				band.period === expectedSalary.period &&
				band.contractType === expectedSalary.contractType &&
				expectedSalary.amount >= band.min,
		);
	const criteria: Assessment['match']['criteria'] = match.criteria.map((item) => {
		if (item.criterion === 'workArrangement' && workArrangementOverride?.length)
			return {
				...item,
				result: 'met',
				evidence: 'manual',
				detail: `Work arrangements: ${workArrangementOverride.join(' / ')}`,
			};
		if (item.criterion === 'salary' && salaryMet)
			return {
				...item,
				result: 'met',
				evidence: 'manual',
				detail: 'Expected salary meets a saved minimum in the same currency, pay period and contract type. Employer pay is unchanged.',
			};
		return item;
	});
	const outcome = matchOutcome(criteria);
	// Search stores only results without failed criteria, and resolutions only mark criteria met.
	if (outcome === 'no-match') throw new Error(`Application ${application.fingerprint} has a failed criterion`);
	return {
		workArrangements: workArrangementOverride ?? shownArrangements(application),
		match: { ...match, criteria, outcome },
	};
}

// Advertised arrangements, else the model's most likely guess.
function shownArrangements({ job, match }: SearchApplication): Assessment['workArrangements'] {
	const advertised = job.advertisedFacts?.workArrangements;
	if (advertised?.length) return advertised;
	const detail = match.criteria.find((item) => item.criterion === 'workArrangement')?.detail;
	// shortcut: reads the "most likely: X" suffix Search's matcher writes; give MatchResult a structured field if that wording changes.
	const likely = workArrangementSchema.safeParse(detail?.match(/most likely: ([a-z-]+)/)?.[1]);
	return likely.success ? [likely.data] : null;
}

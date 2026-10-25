import type { JobDetail } from '@/domain/search-sources/contracts';
import type { Criterion, CriterionResult } from '../contracts';
import type { SearchPreferences } from '../criteria';

export type MatchCriteria = { preferences: SearchPreferences; skills: string[] };

export function locationApplies(job: JobDetail, preferences: SearchPreferences): boolean {
	const arrangements = job.advertisedFacts?.workArrangements;
	return (
		preferences.targetPosition.workArrangements.some((item) => item !== 'remote') &&
		!(arrangements?.length && arrangements.every((item) => item === 'remote'))
	);
}

function normaliseSkill(skill: string): string {
	// shortcut: no alias table (k8s ≠ Kubernetes), add one when misses show up in real results.
	return skill.toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function structuredChecks(job: JobDetail, { preferences, skills }: MatchCriteria): CriterionResult[] {
	const criteria: CriterionResult[] = [];
	const add = (criterion: Criterion, result: CriterionResult['result'], detail: string) =>
		criteria.push({ criterion, result, evidence: 'structured', detail });
	const target = preferences.targetPosition;
	if (job.availability === 'closed') add('availability', 'failed', 'Posting is explicitly closed');
	if (target.salaryRange.length) {
		const comparable = (job.advertisedFacts?.compensation ?? []).flatMap((entry) =>
			target.salaryRange
				.filter(
					(band) =>
						band.contractType === entry.contractType &&
						band.currency === entry.currency &&
						band.period === entry.period,
				)
				.map((band) => ({ top: entry.max ?? entry.min, baseline: band.min })),
		);
		if (comparable.some(({ top, baseline }) => top !== null && top >= baseline))
			add('salary', 'met', 'A comparable advertised range reaches the baseline');
		else if (comparable.length && comparable.every(({ top, baseline }) => top !== null && top < baseline))
			add('salary', 'failed', 'All comparable advertised ranges are below the baseline');
		else add('salary', 'unknown', 'Salary is not advertised in comparable contract, currency and period units');
	}
	const arrangements = job.advertisedFacts?.workArrangements;
	if (arrangements?.length)
		add(
			'workArrangement',
			arrangements.some((item) => target.workArrangements.includes(item)) ? 'met' : 'failed',
			`Advertised arrangements: ${arrangements.join(', ')}`,
		);
	if (locationApplies(job, preferences)) {
		const residence = target.location;
		const same = (a: string | null | undefined, b: string | undefined) =>
			!!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
		if (
			job.locations.some(
				(location) => same(location.city, residence?.city) && same(location.country, residence?.country),
			)
		)
			add('location', 'met', 'Advertised city and country match residence');
	}
	const threshold = preferences.settings.minSkillMatch;
	const required = job.advertisedFacts?.skills;
	if (threshold !== undefined && required !== undefined && required !== null) {
		const candidate = new Set(skills.map(normaliseSkill));
		const mustHaves = new Set(required.map(normaliseSkill));
		const covered = [...mustHaves].filter((skill) => candidate.has(skill)).length;
		const coverage = mustHaves.size ? (covered / mustHaves.size) * 100 : 100;
		add(
			'skills',
			coverage >= threshold ? 'met' : 'failed',
			`Required skill coverage ${Math.round(coverage)}% ${coverage >= threshold ? '≥' : '<'} ${threshold}%`,
		);
	}
	return criteria;
}

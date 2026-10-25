import { digest } from '@/shared/server/workspace-files';
import type { JobSummary } from '@/domain/search-sources/contracts';
import type { SearchPreferences } from '@/domain/matching/criteria';

export function normalize(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}
const legalSuffix = / (inc|ltd|llc|gmbh|sp z o o|s a)$/;

function identity(company: string | null | undefined, title: string, place: string, fallback: unknown[]) {
	const name = company ? normalize(company).replace(legalSuffix, '') : '';
	if (!name) return digest(JSON.stringify(fallback));
	return digest(JSON.stringify([name, normalize(title), normalize(place)]));
}

// shortcut: no city or company alias tables (Warszawa ≠ Warsaw); a miss costs one extra inspection, never a lost vacancy.
export function fingerprint(job: JobSummary): string {
	const place = job.locations[0]?.city ?? job.locations[0]?.country ?? 'remote';
	return identity(job.company?.name, job.title, place, ['source', job.sourceId, job.sourceJobId]);
}

// A typed location's first part stands in for the city, so "Warsaw, Poland" meets a source's "Warsaw".
export function manualFingerprint(row: {
	company: string | null;
	title: string;
	location: string | null;
	url: string;
}) {
	return identity(row.company, row.title, row.location?.split(',')[0]?.trim() || 'remote', ['url', row.url]);
}

// `rulesVersion` comes from matching and `modelIdentity` from the decision model, so a rule or model change
// re-inspects rejections judged under the old ones.
export function criteriaDigest(
	preferences: SearchPreferences,
	skills: string[],
	rulesVersion: number,
	modelIdentity: string,
): string {
	const normalized = [...new Set(skills.map((skill) => normalize(skill).replaceAll(' ', '')))].sort();
	return digest(
		JSON.stringify([
			rulesVersion,
			modelIdentity,
			preferences.targetPosition,
			preferences.settings.minSkillMatch ?? null,
			normalized,
		]),
	);
}

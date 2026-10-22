import { digest } from '@/shared/server/workspace-files';
import type { JobSummary } from '@/shared/search-sources/contracts';
import type { SearchPreferences } from '@/modules/search/model/schema';

export function normalize(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}
const legalSuffix = / (inc|ltd|llc|gmbh|sp z o o|s a)$/;

// shortcut: no city or company alias tables (Warszawa ≠ Warsaw); a miss costs one extra inspection, never a lost vacancy.
export function fingerprint(job: JobSummary): string {
	const company = job.company?.name ? normalize(job.company.name).replace(legalSuffix, '') : '';
	if (!company) return digest(JSON.stringify(['source', job.sourceId, job.sourceJobId]));
	const place = job.locations[0]?.city ?? job.locations[0]?.country ?? 'remote';
	return digest(JSON.stringify([company, normalize(job.title), normalize(place)]));
}

// `rulesVersion` comes from matching, so a rule change re-inspects rejections judged under the old rules.
export function criteriaDigest(preferences: SearchPreferences, skills: string[], rulesVersion: number): string {
	const normalized = [...new Set(skills.map((skill) => normalize(skill).replaceAll(' ', '')))].sort();
	return digest(
		JSON.stringify([
			rulesVersion,
			preferences.targetPosition,
			preferences.settings.minSkillMatch ?? null,
			normalized,
		]),
	);
}

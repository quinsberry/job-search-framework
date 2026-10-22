import { z } from 'zod';
import { jobDetailSchema, type JobDetail } from '@/shared/search-sources/contracts';
import { searchPreferencesSchema } from '../../model/schema';
import { checkSignal, MatchError, validateAnswers, withCancellation, type DecisionModel } from './decision-model';
import { buildQuestions, fitRequest, modelResults } from './questions';
import { criterionResultSchema, structuredChecks, type MatchCriteria } from './structured';

export { MatchError } from './decision-model';
// Part of the search workflow's criteria digest: bump it when a rule change could alter earlier outcomes.
export const MATCHING_RULES_VERSION = 1;
export const matchResultSchema = z.strictObject({
	outcome: z.enum(['match', 'no-match', 'needs-clarification']),
	criteria: z
		.array(criterionResultSchema)
		.max(8)
		.refine((items) => new Set(items.map((item) => item.criterion)).size === items.length),
	costUsd: z.number().nonnegative().nullable(),
});
export type MatchResult = z.infer<typeof matchResultSchema>;
const criteriaSchema = z.strictObject({
	preferences: searchPreferencesSchema,
	skills: z.array(z.string().trim().min(1).max(20000)).max(1000),
});
function finish(criteria: MatchResult['criteria'], costUsd: number | null): MatchResult {
	return matchResultSchema.parse({
		outcome: criteria.some((item) => item.result === 'failed')
			? 'no-match'
			: criteria.some((item) => item.result === 'unknown')
				? 'needs-clarification'
				: 'match',
		criteria,
		costUsd,
	});
}
export async function matchJob(
	detail: JobDetail,
	value: MatchCriteria,
	{ model }: { model: DecisionModel },
	signal: AbortSignal,
): Promise<MatchResult> {
	checkSignal(signal);
	const job = jobDetailSchema.safeParse(detail);
	const criteria = criteriaSchema.safeParse(value);
	if (!job.success || !criteria.success)
		throw new MatchError('invalid-input', 'Invalid vacancy or matching criteria');
	if (criteria.data.preferences.settings.minSkillMatch !== undefined && !criteria.data.skills.length)
		throw new MatchError('invalid-input', 'Add skills to your profile or clear the skill match threshold');
	const structured = structuredChecks(job.data, criteria.data);
	if (structured.some((item) => item.result === 'failed')) return finish(structured, null);
	const questions = buildQuestions(job.data, criteria.data, structured);
	const { request, truncated } = fitRequest(job.data, questions, model.maxInputBytes);
	try {
		const raw = await withCancellation(model.decide(request, signal), signal);
		checkSignal(signal);
		const response = validateAnswers(request, raw);
		return finish([...structured, ...modelResults(response, criteria.data, truncated)], response.costUsd);
	} catch (error) {
		checkSignal(signal);
		if (error instanceof MatchError) throw error;
		if (error instanceof Error && error.name === 'TimeoutError')
			throw new MatchError('timeout', 'Decision model timed out');
		throw new MatchError('unavailable', 'Decision model failed');
	}
}

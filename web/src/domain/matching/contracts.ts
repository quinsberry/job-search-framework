import { z } from 'zod';

export const criterionSchema = z.enum([
	'availability',
	'salary',
	'workArrangement',
	'location',
	'role',
	'seniority',
	'positionType',
	'skills',
]);
export const criterionResultSchema = z.strictObject({
	criterion: criterionSchema,
	result: z.enum(['met', 'failed', 'unknown']),
	evidence: z.enum(['structured', 'model']),
	detail: z.string().trim().min(1).max(2000),
});
export type Criterion = z.infer<typeof criterionSchema>;
export type CriterionResult = z.infer<typeof criterionResultSchema>;

export const matchResultSchema = z.strictObject({
	outcome: z.enum(['match', 'no-match', 'needs-clarification']),
	criteria: z
		.array(criterionResultSchema)
		.max(8)
		.refine((items) => new Set(items.map((item) => item.criterion)).size === items.length),
	costUsd: z.number().nonnegative().nullable(),
});
export type MatchResult = z.infer<typeof matchResultSchema>;
// Only qualifying vacancies and vacancies needing clarification become applications.
export const acceptedMatchResultSchema = matchResultSchema.extend({
	outcome: matchResultSchema.shape.outcome.exclude(['no-match']),
});
export type AcceptedMatchResult = z.infer<typeof acceptedMatchResultSchema>;

// The one Outcome rule: matching applies it to fresh results, Applications to manually resolved ones.
export function matchOutcome(criteria: readonly { result: 'met' | 'failed' | 'unknown' }[]) {
	return criteria.some((item) => item.result === 'failed')
		? 'no-match'
		: criteria.some((item) => item.result === 'unknown')
			? 'needs-clarification'
			: 'match';
}

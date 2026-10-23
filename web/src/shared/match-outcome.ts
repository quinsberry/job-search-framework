// The one Outcome rule: Search applies it to fresh results, Applications to manually resolved ones.
export function matchOutcome(criteria: readonly { result: 'met' | 'failed' | 'unknown' }[]) {
	return criteria.some((item) => item.result === 'failed')
		? 'no-match'
		: criteria.some((item) => item.result === 'unknown')
			? 'needs-clarification'
			: 'match';
}

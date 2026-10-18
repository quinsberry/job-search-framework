export function fieldMessages(error: unknown): string[] {
	if (!error || typeof error !== 'object') return [];
	if ('message' in error && typeof error.message === 'string') return [error.message];
	return [
		...new Set(
			Object.entries(error)
				.filter(([key]) => key !== 'ref')
				.flatMap(([, value]) => fieldMessages(value)),
		),
	];
}

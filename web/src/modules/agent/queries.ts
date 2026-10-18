import { queryOptions } from '@tanstack/react-query';
import { checkAgent } from './api';
export const agentOptions = (provider: string) =>
	queryOptions({
		queryKey: ['agent', provider],
		queryFn: ({ signal }) => checkAgent(provider, signal),
		enabled: false,
		retry: false,
		networkMode: 'always',
	});

import { queryOptions } from '@tanstack/react-query';
import { checkAgent } from './api';
import type { Provider } from '@/shared/ai/contracts';
export const agentOptions = (provider: Provider) =>
	queryOptions({
		queryKey: ['agent', provider],
		queryFn: ({ signal }) => checkAgent(provider, signal),
		enabled: false,
		retry: false,
		networkMode: 'always',
	});

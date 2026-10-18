'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentOptions } from './queries';
import { disconnected } from './contracts';
import { type Provider } from '@/shared/ai/contracts';

const DEFAULT_PROVIDER: Provider = 'codex';

function useAgentState() {
	const [provider, selectProvider] = useState<Provider>(DEFAULT_PROVIDER);
	const { data, error, isFetching, refetch } = useQuery(agentOptions(provider));
	return {
		provider,
		selectProvider,
		connection: data ?? { ...disconnected, ...(error ? { message: error.message } : {}) },
		connecting: isFetching,
		connect: () => refetch(),
	};
}
const AgentContext = createContext<ReturnType<typeof useAgentState> | null>(null);
export function AgentSession({ children }: { children: ReactNode }) {
	const value = useAgentState();
	return <AgentContext value={value}>{children}</AgentContext>;
}
export function useAgent() {
	const value = useContext(AgentContext);
	if (!value) throw new Error('AgentSession is required.');
	return value;
}

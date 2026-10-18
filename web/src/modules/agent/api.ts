import { request } from '@/shared/http/client';
import { readinessSchema } from './contracts';
import type { Provider } from '@/shared/ai/contracts';
export const checkAgent = (provider: Provider, signal?: AbortSignal) =>
	request('/api/agent', { provider }, readinessSchema, signal);

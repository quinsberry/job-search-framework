import { request } from '@/shared/http/client';
import { readinessSchema } from './contracts';
export const checkAgent = (provider: string, signal?: AbortSignal) =>
	request('/api/agent', { provider }, readinessSchema, signal);

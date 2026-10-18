import { request } from '@/shared/http/client';
import { resultSchema, type PreferencesRequest } from '../model/contracts';
export const readSnapshot = (workspace: string, signal?: AbortSignal) =>
	request('/api/search-preferences', { action: 'load', workspace }, resultSchema, signal);
export const persistDraft = (input: Omit<Extract<PreferencesRequest, { action: 'edit' | 'publish' }>, 'action'>) =>
	request('/api/search-preferences', { ...input, action: 'edit' }, resultSchema);
export const publish = (input: Omit<Extract<PreferencesRequest, { action: 'edit' | 'publish' }>, 'action'>) =>
	request('/api/search-preferences', { ...input, action: 'publish' }, resultSchema);
export const discard = (workspace: string, revision: string) =>
	request('/api/search-preferences', { action: 'discard', workspace, revision }, resultSchema);

import type { Provider } from '@/shared/ai/contracts';
import { request } from '@/shared/http/client';
import { profileResultSchema, type ProfileRequest } from '../model/contracts';
export const readSnapshot = (workspace: string, signal?: AbortSignal) =>
	request('/api/profile', { action: 'load', workspace }, profileResultSchema, signal);
export const persistDraft = (input: Omit<Extract<ProfileRequest, { action: 'edit' | 'publish' }>, 'action'>) =>
	request('/api/profile', { ...input, action: 'edit' }, profileResultSchema);
export const publish = (input: Omit<Extract<ProfileRequest, { action: 'edit' | 'publish' }>, 'action'>) =>
	request('/api/profile', { ...input, action: 'publish' }, profileResultSchema);
export const discard = (workspace: string, revision: string) =>
	request('/api/profile', { action: 'discard', workspace, revision }, profileResultSchema);
export const retryImport = (workspace: string, revision: string, provider: Provider) =>
	request('/api/profile', { action: 'retry', workspace, revision, provider }, profileResultSchema);
export function startImport(workspace: string, revision: string, file: File, provider: Provider) {
	const data = new FormData();
	data.set('workspace', workspace);
	data.set('revision', revision);
	data.set('file', file);
	data.set('provider', provider);
	return request('/api/profile', data, profileResultSchema);
}

import type { Provider } from '@/shared/ai/contracts';
import { ProfileRepository, type ProfilePersistence } from './persistence';
import { ConversionService } from './conversion';
import { getProvider } from '@/shared/ai/server/providers';
import type { ProfileRequest, ProfileResult } from '../model/contracts';

export function createProfileApplication(
	resolveProvider = getProvider,
	open: (workspace: string) => Promise<ProfilePersistence> = ProfileRepository.open,
) {
	const result = async (
		workspace: string,
		operation: (repo: ProfilePersistence) => Promise<ProfileResult['snapshot']>,
	): Promise<ProfileResult> => {
		const repo = await open(workspace);
		return { workspace: repo.workspace, snapshot: await operation(repo) };
	};
	return {
		readSnapshot: (workspace: string) => result(workspace, (repo) => repo.load()),
		startImport: (workspace: string, revision: string, file: File, provider: Provider) =>
			result(workspace, (repo) => new ConversionService(resolveProvider(provider)).start(repo, file, revision)),
		retryImport: (workspace: string, revision: string, provider: Provider) =>
			result(workspace, (repo) => new ConversionService(resolveProvider(provider)).retry(repo, revision)),
		persistDraft: (input: Extract<ProfileRequest, { action: 'edit' | 'publish' }>) =>
			result(input.workspace, (repo) => repo.edit(input.values, input.revision, input.recordIds)),
		publish: (input: Extract<ProfileRequest, { action: 'edit' | 'publish' }>) =>
			result(input.workspace, (repo) => repo.publish(input.values, input.revision, input.recordIds)),
		discard: (workspace: string, revision: string) => result(workspace, (repo) => repo.discard(revision)),
	};
}
export const profileApplication = createProfileApplication();

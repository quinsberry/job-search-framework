import { isAbsolute, resolve } from 'node:path';
import { ProfileRepository } from '@/modules/profile/server/persistence';
import { PreferencesRepository } from '@/modules/search/server/persistence';

// Shared wiring for the evaluation commands; flag parsing lives in each command.
export function workspacePath(value: string | undefined): string {
	if (!value) fail('--workspace is required');
	return isAbsolute(value) ? value : resolve(value);
}

// The saved, published matching inputs, never drafts, as the search run reads them.
export async function savedCandidate(workspace: string) {
	const preferences = await (await PreferencesRepository.open(workspace)).published();
	if (!preferences) return null;
	const skills = (await (await ProfileRepository.open(workspace)).load()).profile?.skills ?? [];
	return { preferences, skills };
}

export function interruptSignal(): AbortSignal {
	const controller = new AbortController();
	process.once('SIGINT', () => controller.abort());
	return controller.signal;
}

export function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

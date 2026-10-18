import type { AIProvider } from '../contracts';
import { codexProvider } from './codex';
const providers: ReadonlyMap<string, AIProvider> = new Map([[codexProvider.id, codexProvider]]);
export function getProvider(id: string): AIProvider {
	const provider = providers.get(id);
	if (!provider) throw new Error('Unknown AI provider.');
	return provider;
}

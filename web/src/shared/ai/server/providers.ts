import type { AIProvider, Provider } from '../contracts';
import { claudeProvider } from './claude';
import { codexProvider } from './codex';

export const providers = {
	[codexProvider.id]: codexProvider,
	[claudeProvider.id]: claudeProvider,
} satisfies { [Id in Provider]: AIProvider & { readonly id: Id } };

export function getProvider(id: Provider): AIProvider {
	return providers[id];
}

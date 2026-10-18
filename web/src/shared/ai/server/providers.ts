import type { AIProvider, Provider } from '../contracts';
import { codexProvider } from './codex';

export const providers = {
	[codexProvider.id]: codexProvider,
} satisfies { [Id in Provider]: AIProvider & { readonly id: Id } };

export function getProvider(id: Provider): AIProvider {
	return providers[id];
}

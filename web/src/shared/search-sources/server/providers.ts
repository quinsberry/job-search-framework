import type { SearchSourceAdapter, SourceId } from '../contracts';
import { linkedinProvider } from './linkedin/provider';

export const providers = {
	linkedin: linkedinProvider,
} satisfies { [Id in SourceId]: SearchSourceAdapter & { descriptor: { id: Id } } };

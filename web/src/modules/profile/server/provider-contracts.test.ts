import { expect, test } from 'bun:test';
import { providerSchema } from '@/shared/ai/contracts';
import { getProvider } from '@/shared/ai/server/providers';
import { profileRequestSchema, jobSchema } from '../model/contracts';

test('supported IDs resolve to matching adapters and default new requests', () => {
	for (const id of providerSchema.options) {
		expect(providerSchema.parse(id)).toBe(id);
		expect(getProvider(id).id).toBe(id);
	}
	expect(profileRequestSchema.parse({ action: 'retry', workspace: '/workspace', revision: '1' })).toMatchObject({
		provider: providerSchema.options[0],
	});
});

test('historical job providers remain readable without becoming selectable', () => {
	expect(jobSchema.shape.provider.parse('retired-provider')).toBe('retired-provider');
	expect(providerSchema.safeParse('retired-provider').success).toBe(false);
});

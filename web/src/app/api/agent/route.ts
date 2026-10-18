import { z } from 'zod';
import { localRequest } from '@/shared/http/server';
import { getProvider } from '@/shared/ai/server/providers';
import { providerSchema } from '@/shared/ai/contracts';

export async function POST(request: Request) {
	return localRequest(request, async (body) => {
		const { provider } = z.strictObject({ provider: providerSchema }).parse(await body.json());
		return getProvider(provider).check();
	});
}

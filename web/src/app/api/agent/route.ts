import { z } from 'zod';
import { localRequest } from '@/shared/http/server';
import { getProvider } from '@/shared/ai/server/providers';
export async function POST(request: Request) {
	return localRequest(request, async (body) => {
		const { provider } = z.strictObject({ provider: z.string() }).parse(await body.json());
		return getProvider(provider).check();
	});
}

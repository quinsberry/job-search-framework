import { localRequest } from '@/shared/http/server';
import { loadRequestSchema } from '@/modules/applications/model/contracts';
import { ApplicationStore } from '@/modules/applications/server/store';

export async function POST(request: Request) {
	return localRequest(request, async (body) => {
		const input = loadRequestSchema.parse(await body.json());
		// No lock: runs replace applications.json atomically, so reads never see a partial file.
		return {
			applications: await (await ApplicationStore.open(input.workspace)).list(),
		};
	});
}

import { localRequest } from '@/shared/http/server';
import { requestSchema, type PreferencesResult } from '@/modules/search/model/contracts';
import { PreferencesRepository } from '@/modules/search/server/persistence';

export async function POST(request: Request) {
	return localRequest(request, async (body): Promise<PreferencesResult> => {
		const input = requestSchema.parse(await body.json());
		const repo = await PreferencesRepository.open(input.workspace);
		let snapshot;
		switch (input.action) {
			case 'load':
				snapshot = await repo.load();
				break;
			case 'edit':
				snapshot = await repo.edit(input.values, input.revision);
				break;
			case 'publish':
				snapshot = await repo.publish(input.values, input.revision);
				break;
			case 'discard':
				snapshot = await repo.discard(input.revision);
				break;
		}
		return { workspace: repo.workspace, snapshot };
	});
}

import { localRequest } from '@/shared/http/server';
import { listSearchSources } from '@/shared/search-sources/server/search.service';
import { applicationsRequestSchema } from '@/modules/applications/model/contracts';
import { ApplicationList } from '@/modules/applications/server/application-list';
import { migrateWorkspace } from '@/modules/applications/server/migration';

export async function POST(request: Request) {
	return localRequest(request, async (body) => {
		const input = applicationsRequestSchema.parse(await body.json());
		await migrateWorkspace(input.workspace);
		const list = await ApplicationList.open(input.workspace);
		switch (input.action) {
			// No lock: every write replaces applications.json atomically, so reads never see a partial file.
			case 'load':
				return { applications: await list.list(), sources: listSearchSources() };
			case 'add':
				return { row: await list.addManual(input.row, new Date()) };
			case 'update':
				return { row: await list.update(input.fingerprint, input.changes) };
			case 'delete':
				await list.remove(input.fingerprint);
				return {};
		}
	});
}

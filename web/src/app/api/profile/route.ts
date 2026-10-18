import { z } from 'zod';
import { localRequest } from '@/shared/http/server';
import { profileRequestSchema } from '@/modules/profile/model/contracts';
import { profileApplication as app } from '@/modules/profile/server/application';
export async function POST(request: Request) {
	return localRequest(request, async (body) => {
		if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
			const data = await body.formData();
			const file = data.get('file');
			if (!(file instanceof File)) throw new Error('Choose a CV file.');
			return app.startImport(
				z.string().parse(data.get('workspace')),
				z.string().parse(data.get('revision')),
				file,
				z.string().parse(data.get('provider') ?? 'codex'),
			);
		}
		const input = profileRequestSchema.parse(await body.json());
		switch (input.action) {
			case 'load':
				return app.readSnapshot(input.workspace);
			case 'retry':
				return app.retryImport(input.workspace, input.revision, input.provider);
			case 'discard':
				return app.discard(input.workspace, input.revision);
			case 'edit':
				return app.persistDraft(input);
			case 'publish':
				return app.publish(input);
		}
	});
}

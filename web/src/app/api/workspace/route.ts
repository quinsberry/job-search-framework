import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { localRequest } from '@/shared/http/server';
export async function POST(request: Request) {
	return localRequest(request, async (body) => {
		const { workspace } = z.strictObject({ workspace: z.string() }).parse(await body.json());
		if (!isAbsolute(workspace)) throw new Error('Select an absolute workspace folder.');
		const resolved = await realpath(workspace);
		if (!(await stat(resolved)).isDirectory()) throw new Error('Workspace must be a folder.');
		return { workspace: resolved };
	});
}

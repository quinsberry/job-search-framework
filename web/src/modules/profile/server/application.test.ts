import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfileApplication } from './application';
import { emptyProfile } from '../model/schema';
import { processing } from '../model/contracts';
test('application uses an injected neutral provider; manual commands and reads never interpret', async () => {
	const path = await mkdtemp(join(tmpdir(), 'profile-app-'));
	let calls = 0;
	const app = createProfileApplication(() => ({
		id: 'fictional-provider',
		check: async () => ({ available: true, message: 'Ready', cacheIdentity: 'fictional-v1' }),
		interpret: async (request) => {
			calls++;
			expect(request.instructions).toContain('untrusted');
			expect(request.outputSchema).toHaveProperty('properties');
			return { ...emptyProfile, identity: { fullName: 'Fictional Alex' } };
		},
	}));
	try {
		const loaded = await app.readSnapshot(path);
		let result = await app.startImport(
			path,
			loaded.snapshot.revision,
			new File(['# Fictional CV'], 'cv.md'),
			'codex',
		);
		for (let n = 0; n < 100 && processing(result.snapshot.job); n++) {
			await Bun.sleep(5);
			result = await app.readSnapshot(path);
		}
		expect(result.snapshot.job?.phase).toBe('ready');
		expect(result.snapshot.job?.provider).toBe('fictional-provider');
		const values = result.snapshot.draft!.values;
		const recordIds = result.snapshot.draft!.recordIds;
		const edited = await app.persistDraft({
			action: 'edit',
			workspace: path,
			revision: result.snapshot.revision,
			values,
			recordIds,
		});
		const saved = await app.publish({
			action: 'publish',
			workspace: path,
			revision: edited.snapshot.revision,
			values,
			recordIds,
		});
		expect(saved.snapshot.profile?.identity.fullName).toBe('Fictional Alex');
		await app.discard(path, saved.snapshot.revision);
		await app.readSnapshot(path);
		expect(calls).toBe(1);
	} finally {
		await rm(path, { recursive: true, force: true });
	}
});

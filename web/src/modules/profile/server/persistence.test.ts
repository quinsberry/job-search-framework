import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyProfile, toDraft } from '../model/schema';
import { recordIdsFor } from '../model/contracts';
import { ProfileRepository } from './persistence';

const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const path = await mkdtemp(join(tmpdir(), 'profile-test-'));
	folders.push(path);
	return { path, repo: await ProfileRepository.open(path) };
}
test('draft recovery does not publish; Save writes readable YAML and detects concurrent edits', async () => {
	const { path, repo } = await setup();
	const initial = await repo.load();
	const values = {
		...emptyProfile,
		identity: { ...emptyProfile.identity, fullName: 'Alex Example', phone: '+48000111' },
	};
	const draft = await repo.edit(values, initial.revision);
	expect((await ProfileRepository.open(path).then((repo) => repo.load())).draft?.values.identity.fullName).toBe(
		'Alex Example',
	);
	expect((await repo.load()).profile).toBeNull();
	await expect(repo.edit(emptyProfile, initial.revision)).rejects.toThrow('changed');
	const saved = await repo.publish(values, draft.revision);
	expect(saved.profile?.identity.fullName).toBe('Alex Example');
	const yaml = await readFile(join(path, 'candidate-profile/profile.yaml'), 'utf8');
	expect(yaml).toContain('fullName: Alex Example');
	await writeFile(join(path, 'candidate-profile/profile.yaml'), yaml.replace('Alex Example', 'Alex External'));
	await expect(repo.publish(values, saved.revision)).rejects.toThrow('changed');
});
test('unknown YAML fields and symlinked storage are rejected without rewriting files', async () => {
	const { path, repo } = await setup();
	const values = { ...emptyProfile, identity: { fullName: 'Alex' } };
	await repo.publish(values, (await repo.load()).revision);
	const target = join(path, 'candidate-profile/profile.yaml');
	const yaml = await readFile(target, 'utf8');
	await writeFile(target, yaml + '\nprojects: []\n');
	await expect(repo.load()).rejects.toThrow();
	await rm(target);
	await symlink(join(path, 'external.yaml'), target);
	await expect(repo.load()).rejects.toThrow('symbolic');
});
test('orphaned conversion becomes interrupted without changing the previous draft', async () => {
	const { repo } = await setup();
	const initial = await repo.edit(
		{ ...emptyProfile, identity: { fullName: 'Previous' } },
		(await repo.load()).revision,
	);
	await repo.beginConversion(initial.revision, {
		id: 'orphan',
		source: 'a'.repeat(64) + '.md',
		cacheKey: 'b'.repeat(64),
		provider: 'codex',
		phase: 'converting',
		startedAt: Date.now(),
		ownerPid: 2147483647,
		ownerId: 'previous-process',
	});
	const recovered = await repo.load();
	expect(recovered.job?.phase).toBe('interrupted');
	expect(recovered.draft?.values.identity.fullName).toBe('Previous');
	expect((await repo.load()).revision).toBe(recovered.revision);
});
test('removing a preceding record and editing the survivor retains its identity through Save', async () => {
	const { repo } = await setup();
	const values = toDraft({
		...emptyProfile,
		identity: { ...emptyProfile.identity, fullName: 'Alex' },
		experience: [
			{ company: 'First', role: 'Engineer' },
			{ company: 'Second', role: 'Engineer' },
		],
	} as Parameters<typeof toDraft>[0]);
	const ids = recordIdsFor(values);
	const initial = await repo.edit(values, (await repo.load()).revision, ids);
	const survivor = { ...values, experience: [{ ...values.experience[1], role: 'Senior Engineer' }] };
	const survivingIds = { ...ids, experience: [ids.experience![1]] };
	const edited = await repo.edit(survivor, initial.revision, survivingIds);
	const saved = await repo.publish(survivor, edited.revision, survivingIds);
	expect(saved.recordIds.experience).toEqual([ids.experience![1]]);
});

test('publication survives a failed draft cleanup and does not resurrect the published draft', async () => {
	const { path, repo } = await setup();
	const values = toDraft({
		...emptyProfile,
		identity: { fullName: 'Alex' },
		experience: [{ company: 'Example', role: 'Engineer' }],
	} as Parameters<typeof toDraft>[0]);
	const ids = recordIdsFor(values);
	const draft = await repo.edit(values, (await repo.load()).revision, ids);
	// Fault injection targets the private atomic YAML boundary.
	const storage = repo as unknown as { write(name: string, value: unknown): Promise<void> };
	const write = storage.write.bind(storage);
	const failure = spyOn(storage, 'write').mockImplementation(async (name, value) => {
		if (name === 'draft.yaml') throw new Error('ENOSPC');
		return write(name, value);
	});
	try {
		const saved = await repo.publish(values, draft.revision, ids);
		expect(saved.profile?.identity.fullName).toBe('Alex');
		expect(saved.draft).toBeNull();
		expect(saved.recordIds).toEqual(ids);
	} finally {
		failure.mockRestore();
	}

	const reopened = await ProfileRepository.open(path);
	const saved = await reopened.load();
	expect(saved.draft).toBeNull();
	expect(saved.recordIds).toEqual(ids);
	const changed = await reopened.edit(
		{ ...values, identity: { ...values.identity, fullName: 'Alex Edited' } },
		saved.revision,
		ids,
	);
	expect(changed.draft?.id).not.toBe(draft.draft?.id);
	expect((await reopened.load()).draft?.values.identity.fullName).toBe('Alex Edited');
});

test('a failed profile write preserves the previous publication and recovery draft', async () => {
	const { repo } = await setup();
	const previous = { ...emptyProfile, identity: { fullName: 'Previous' } };
	const published = await repo.publish(previous, (await repo.load()).revision);
	const values = { ...emptyProfile, identity: { fullName: 'Replacement' } };
	const draft = await repo.edit(values, published.revision);
	// Fault injection targets the private atomic YAML boundary.
	const storage = repo as unknown as { write(name: string, value: unknown): Promise<void> };
	const write = storage.write.bind(storage);
	const failure = spyOn(storage, 'write').mockImplementation(async (name, value) => {
		if (name === 'profile.yaml') throw new Error('ENOSPC');
		return write(name, value);
	});
	try {
		await expect(repo.publish(values, draft.revision)).rejects.toThrow('ENOSPC');
	} finally {
		failure.mockRestore();
	}
	const recovered = await repo.load();
	expect(recovered.profile?.identity.fullName).toBe('Previous');
	expect(recovered.draft?.values.identity.fullName).toBe('Replacement');
	expect(recovered.revision).toBe(draft.revision);
});

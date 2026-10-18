import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileRepository } from './persistence';
import { ConversionService } from './conversion';
import { emptyProfile, proficiencyLevels } from '../model/schema';
import { processing } from '../model/contracts';

const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
	const path = await mkdtemp(join(tmpdir(), 'conversion-test-'));
	folders.push(path);
	return ProfileRepository.open(path);
}
async function completed(repo: ProfileRepository) {
	for (let count = 0; count < 100; count++) {
		const state = await repo.load();
		if (!processing(state.job)) return state;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('Conversion did not finish');
}
test('conversion is recoverable, duplicate uploads reuse output and manual corrections stay intact', async () => {
	const repo = await setup();
	let calls = 0;
	const service = new ConversionService({
		id: 'codex',
		check: async () => ({ available: true, message: 'Available', cacheIdentity: 'fixture-v1' }),
		interpret: async () => {
			calls++;
			return { ...emptyProfile, identity: { fullName: 'Alex' } };
		},
	});
	const file = new File(['# Alex\nSoftware engineer'], 'cv.md');
	await service.start(repo, file, (await repo.load()).revision);
	let result = await completed(repo);
	expect(result.draft?.values.identity.fullName).toBe('Alex');
	expect(result.profile).toBeNull();
	await service.start(repo, file, result.revision);
	result = await completed(repo);
	expect(calls).toBe(1);
	result = await repo.edit({ ...result.draft!.values, identity: { fullName: 'Alex Corrected' } }, result.revision);
	expect((await repo.load()).draft?.values.identity.fullName).toBe('Alex Corrected');
	expect(calls).toBe(1);
});
test('failed replacement retains previous draft; retry reuses extraction and needs explicit invocation', async () => {
	const repo = await setup();
	let calls = 0;
	const original = await repo.edit(
		{ ...emptyProfile, identity: { fullName: 'Previous' } },
		(await repo.load()).revision,
	);
	const service = new ConversionService({
		id: 'codex',
		check: async () => ({ available: true, message: 'Available', cacheIdentity: 'fixture-v1' }),
		interpret: async () => {
			if (++calls === 1) throw new Error('Provider unavailable');
			return { ...emptyProfile, identity: { fullName: 'New' } };
		},
	});
	await service.start(repo, new File(['# New'], 'new.md'), original.revision);
	let result = await completed(repo);
	expect(result.job?.phase).toBe('failed');
	expect(result.draft?.values.identity.fullName).toBe('Previous');
	await repo.load();
	await repo.load();
	expect(calls).toBe(1);
	await service.retry(repo, result.revision);
	result = await completed(repo);
	expect(result.draft?.values.identity.fullName).toBe('New');
	expect(calls).toBe(2);
});
test('retry validates committed provider output instead of spending tokens again after interruption', async () => {
	const repo = await setup();
	let calls = 0;
	const service = new ConversionService({
		id: 'codex',
		check: async () => ({ available: true, message: 'Available', cacheIdentity: 'fixture-v1' }),
		interpret: async () => {
			calls++;
			throw new Error('Interrupted before delivery');
		},
	});
	await service.start(repo, new File(['# Alex'], 'cv.md'), (await repo.load()).revision);
	const failed = await completed(repo);
	await repo.storeConversionOutput(failed.job!.cacheKey, 'raw', {
		...emptyProfile,
		identity: { fullName: 'Alex Recovered' },
	});
	await service.retry(repo, failed.revision);
	const recovered = await completed(repo);
	expect(recovered.draft?.values.identity.fullName).toBe('Alex Recovered');
	expect(calls).toBe(1);
});

test('an explicit upload replaces an old cached free-text proficiency with fixed-level output', async () => {
	const { default: fixture } = await import('./fixtures/legacy-cache.json');
	const { mkdir, writeFile } = await import('node:fs/promises');
	const { YAML } = await import('bun');
	const repo = await setup();
	const base = join(repo.workspace, 'candidate-profile/conversions', fixture.cacheKey);
	await mkdir(base, { recursive: true });
	await writeFile(join(base, 'text.txt'), fixture.text);
	await writeFile(
		join(base, 'result.yaml'),
		YAML.stringify({
			...fixture.output,
			languages: [{ language: 'English', proficiency: 'fluent' }],
		}),
	);
	let calls = 0;
	const service = new ConversionService({
		id: 'codex',
		check: async () => ({ available: true, message: 'Available', cacheIdentity: fixture.identity }),
		interpret: async (request) => {
			calls++;
			expect(request.instructions).toContain(JSON.stringify(proficiencyLevels));
			expect(request.outputSchema).toMatchObject({
				properties: {
					languages: { items: { properties: { proficiency: { enum: [...proficiencyLevels] } } } },
				},
			});
			return { ...fixture.output, languages: [{ language: 'English', proficiency: '' }] };
		},
	});
	const file = new File([fixture.bytes], 'cv.md');
	await service.start(repo, file, (await repo.load()).revision);
	const result = await completed(repo);
	expect(result.job?.phase).toBe('ready');
	expect(result.draft?.values.languages).toEqual([{ language: 'English', proficiency: '' }]);
	expect(calls).toBe(1);
	await service.start(repo, file, result.revision);
	expect((await completed(repo)).job?.phase).toBe('ready');
	expect(calls).toBe(1);
});

for (const checkpoint of ['validated', 'raw'] as const) {
	test(`pre-refactor ${checkpoint} cache is reused without interpretation`, async () => {
		const { default: fixture } = await import('./fixtures/legacy-cache.json');
		const { mkdir, writeFile } = await import('node:fs/promises');
		const { YAML } = await import('bun');
		const repo = await setup();
		const base = join(repo.workspace, 'candidate-profile/conversions', fixture.cacheKey);
		await mkdir(base, { recursive: true });
		await writeFile(join(base, 'text.txt'), fixture.text);
		await writeFile(
			join(base, checkpoint === 'raw' ? 'raw-output.yaml' : 'result.yaml'),
			YAML.stringify(fixture.output),
		);
		let calls = 0;
		let identity = fixture.identity;
		const service = new ConversionService({
			id: 'codex',
			check: async () => ({ available: true, message: 'Available', cacheIdentity: identity }),
			interpret: async () => {
				calls++;
				throw new Error('Unexpected paid interpretation');
			},
		});
		const started = await service.start(
			repo,
			new File([fixture.bytes], 'cv.markdown'),
			(await repo.load()).revision,
		);
		expect(started.job?.source).toBe(fixture.source);
		expect(started.job?.cacheKey).toBe(fixture.cacheKey);
		const finished = await completed(repo);
		expect(finished.job?.phase).toBe('ready');
		expect(finished.draft?.values).toEqual(fixture.output);
		expect(calls).toBe(0);
		await service.start(repo, new File([fixture.bytes + ' changed'], 'cv.md'), finished.revision);
		const changedBytes = await completed(repo);
		expect(changedBytes.job?.phase).toBe('failed');
		expect(calls).toBe(1);
		identity = fixture.identity + ':changed-settings';
		const changedSettings = await service.start(repo, new File([fixture.bytes], 'cv.md'), changedBytes.revision);
		expect(changedSettings.job?.cacheKey).not.toBe(fixture.cacheKey);
		expect((await completed(repo)).job?.phase).toBe('failed');
		expect(calls).toBe(2);
	});
}

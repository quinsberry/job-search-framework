import { YAML } from 'bun';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import {
	emptyState,
	processing,
	ProfileError,
	profileFileSchema,
	stateSchema,
	recordIdsFor,
	recordIdsSchema,
	recordSections,
	type RecordIds,
	type ProfileSnapshot,
	type ProfileState,
} from '../model/contracts';
import { profileDraftSchema, profileSchema, toDraft, type ProfileDraft } from '../model/schema';

export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export class ProfileRepository {
	private constructor(
		readonly workspace: string,
		private root: string,
	) {}
	static async open(workspace: string) {
		if (!isAbsolute(workspace)) throw new ProfileError('invalid', 'Select an absolute workspace folder.');
		const resolved = await realpath(workspace);
		if (!(await stat(resolved)).isDirectory()) throw new ProfileError('invalid', 'Workspace must be a folder.');
		const root = join(resolved, 'candidate-profile');
		await mkdir(root, { recursive: true });
		if ((await lstat(root)).isSymbolicLink())
			throw new ProfileError('invalid', 'Profile storage cannot use symbolic links.');
		return new ProfileRepository(resolved, root);
	}
	private async path(name: string) {
		const path = join(this.root, name);
		const rel = relative(this.root, path);
		if (rel.startsWith('..') || isAbsolute(rel)) throw new ProfileError('invalid', 'Invalid storage path.');
		let current = this.workspace;
		for (const part of relative(this.workspace, path).split(sep)) {
			current = join(current, part);
			try {
				if ((await lstat(current)).isSymbolicLink())
					throw new ProfileError('invalid', 'Profile storage cannot use symbolic links.');
			} catch (error) {
				if (!missing(error)) throw error;
			}
		}
		return path;
	}
	private async read(name: string): Promise<string | null> {
		try {
			return await readFile(await this.path(name), 'utf8');
		} catch (error) {
			if (missing(error)) return null;
			throw error;
		}
	}
	private async write(name: string, value: unknown) {
		await this.writeBytes(name, YAML.stringify(value, null, 2));
	}
	private async writeBytes(name: string, bytes: string | Uint8Array) {
		const path = await this.path(name);
		await mkdir(join(path, '..'), { recursive: true });
		await this.path(name);
		const temporary = path + '.' + randomUUID() + '.tmp';
		try {
			await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	async readSource(name: string) {
		return readFile(await this.path('sources/' + name));
	}
	private async lock<T>(action: () => Promise<T>): Promise<T> {
		const lock = await this.path('.lock');
		for (let attempt = 0; ; attempt++) {
			try {
				await mkdir(lock);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				try {
					const owner = await this.read('.lock/owner');
					if (owner ? !alive(Number(owner)) : Date.now() - (await stat(lock)).mtimeMs > 5000) {
						await rm(lock, { recursive: true, force: true });
						continue;
					}
				} catch (error) {
					if (missing(error)) continue;
					throw error;
				}
				if (attempt >= 100) throw new ProfileError('conflict', 'Profile is busy. Please retry.');
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		}
		try {
			await writeFile(join(lock, 'owner'), String(process.pid));
			return await action();
		} finally {
			await rm(lock, { recursive: true, force: true });
		}
	}
	private async snapshot(): Promise<ProfileSnapshot> {
		const [profileText, stateText] = await Promise.all([this.read('profile.yaml'), this.read('draft.yaml')]);
		const published = profileText === null ? null : profileFileSchema.parse(YAML.parse(profileText));
		const profile = published?.profile ?? null;
		const state = stateText === null ? structuredClone(emptyState) : stateSchema.parse(YAML.parse(stateText));
		if (published?.publication) {
			state.recordIds = published.publication.recordIds;
			// The profile rename commits publication even if draft cleanup was interrupted.
			if (state.draft?.id === published.publication.draftId) state.draft = null;
		}
		return { ...state, profile, revision: digest(JSON.stringify([profileText, stateText])) };
	}
	async load() {
		return this.lock(async () => {
			let snapshot = await this.snapshot();
			if (
				processing(snapshot.job) &&
				snapshot.job &&
				(!alive(snapshot.job.ownerPid) || Date.now() - snapshot.job.startedAt > 360_000)
			) {
				snapshot.job.phase = 'interrupted';
				snapshot.job.error =
					'Conversion was interrupted. Retry reuses completed stages; unfinished AI work may consume tokens again.';
				await this.write('draft.yaml', {
					schemaVersion: 1,
					recordIds: snapshot.recordIds,
					draft: snapshot.draft,
					job: snapshot.job,
				});
				snapshot = await this.snapshot();
			}
			return snapshot;
		});
	}
	private async change(
		expected: string | undefined,
		update: (state: ProfileState, current: ProfileSnapshot) => Promise<void> | void,
	) {
		return this.lock(async () => {
			const current = await this.snapshot();
			if (expected !== undefined && expected !== current.revision)
				throw new ProfileError(
					'conflict',
					'Profile changed in another tab or on disk. Your edits are retained; reload to review current data.',
				);
			const state = stateSchema.parse({
				schemaVersion: 1,
				recordIds: current.recordIds,
				draft: current.draft,
				job: current.job,
			});
			await update(state, current);
			await this.write('draft.yaml', stateSchema.parse(state));
			return this.snapshot();
		});
	}
	async edit(values: unknown, expected: string, recordIds?: RecordIds) {
		const parsed = profileDraftSchema.parse(values);
		return this.change(expected, (state) => {
			if (processing(state.job))
				throw new ProfileError('conflict', 'Wait for conversion to finish before editing.');
			state.draft = this.draft(parsed, state, recordIds);
		});
	}
	private draft(
		values: ProfileDraft,
		state: ProfileState,
		suppliedIds?: RecordIds,
	): NonNullable<ProfileState['draft']> {
		const recordIds = recordIdsSchema.parse(suppliedIds ?? recordIdsFor(values));
		for (const section of recordSections) {
			const ids = recordIds[section] ?? [];
			if (ids.length !== values[section].length || new Set(ids).size !== ids.length)
				throw new ProfileError('invalid', 'Record identities must match the profile entries.');
		}
		return { id: state.draft?.id ?? randomUUID(), values, recordIds };
	}
	async publish(values: unknown, expected: string, recordIds?: RecordIds) {
		const profile = profileSchema.parse(values);
		return this.lock(async () => {
			const current = await this.snapshot();
			if (expected !== current.revision)
				throw new ProfileError(
					'conflict',
					'Profile changed in another tab or on disk. Your edits are retained; reload to review current data.',
				);
			if (processing(current.job))
				throw new ProfileError('conflict', 'Wait for conversion to finish before saving.');
			const ids = this.draft(toDraft(profile), current, recordIds ?? current.draft?.recordIds).recordIds;
			await this.write('profile.yaml', {
				schemaVersion: 1,
				profile,
				publication: { draftId: current.draft?.id ?? null, recordIds: ids },
			});
			try {
				await this.write('draft.yaml', { schemaVersion: 1, recordIds: ids, draft: null, job: current.job });
			} catch {
				// Readers reconcile the committed marker; the next draft write finishes cleanup.
			}
			return this.snapshot();
		});
	}
	async storeSource(source: string, bytes: Uint8Array) {
		await this.writeBytes('sources/' + source, bytes);
	}
	async readExtractedText(key: string) {
		return this.read('conversions/' + key + '/text.txt');
	}
	async storeExtractedText(key: string, text: string) {
		await this.writeBytes('conversions/' + key + '/text.txt', text);
	}
	async readConversionOutput(key: string, kind: 'raw' | 'validated'): Promise<unknown | null> {
		const value = await this.read('conversions/' + key + (kind === 'raw' ? '/raw-output.yaml' : '/result.yaml'));
		return value === null ? null : YAML.parse(value);
	}
	async storeConversionOutput(key: string, kind: 'raw' | 'validated', value: unknown) {
		await this.write('conversions/' + key + (kind === 'raw' ? '/raw-output.yaml' : '/result.yaml'), value);
	}
	async beginConversion(expected: string, job: import('../model/contracts').ConversionJob) {
		return this.change(expected, (state) => {
			if (processing(state.job)) throw new ProfileError('conflict', 'Another CV is already being converted.');
			state.job = job;
		});
	}
	async conversionPhase(id: string, phase: import('../model/contracts').ConversionJob['phase'], error?: string) {
		return this.change(undefined, (state) => {
			if (state.job?.id !== id) throw new ProfileError('conflict', 'Conversion was replaced.');
			state.job.phase = phase;
			state.job.error = error;
		});
	}
	async completeConversion(id: string, values: ProfileDraft) {
		return this.change(undefined, (state) => {
			if (state.job?.id !== id) throw new ProfileError('conflict', 'Conversion was replaced.');
			state.draft = this.draft(values, { ...state, draft: null });
			state.job.phase = 'ready';
			state.job.error = undefined;
		});
	}

	async discard(expected: string) {
		return this.change(expected, (state) => {
			if (processing(state.job)) throw new ProfileError('conflict', 'Wait for conversion before discarding.');
			state.draft = null;
			state.job = null;
		});
	}
}

export function errorMessage(error: unknown) {
	if (error instanceof z.ZodError)
		return error.issues.map((issue) => `${issue.path.join('.') || 'Profile'}: ${issue.message}`).join('; ');
	return error instanceof Error ? error.message : 'Profile operation failed.';
}

export type ProfilePersistence = Pick<ProfileRepository, keyof ProfileRepository>;

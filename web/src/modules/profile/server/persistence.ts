import { YAML } from 'bun';
import { z } from 'zod';
import { WorkspaceFiles, digest, alive } from '@/shared/server/workspace-files';
export { digest } from '@/shared/server/workspace-files';
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

export class ProfileRepository {
	private constructor(private files: WorkspaceFiles) {}
	get workspace() {
		return this.files.workspace;
	}
	static async open(workspace: string) {
		return new ProfileRepository(await WorkspaceFiles.open(workspace, 'candidate-profile'));
	}
	private read(name: string) {
		return this.files.read(name);
	}
	private write(name: string, value: unknown) {
		return this.files.write(name, value);
	}
	private writeBytes(name: string, bytes: string | Uint8Array) {
		return this.files.writeBytes(name, bytes);
	}
	private lock<T>(action: () => Promise<T>): Promise<T> {
		return this.files.lock(action);
	}
	readSource(name: string) {
		return this.files.readBytes('sources/' + name);
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
		return { id: state.draft?.id ?? crypto.randomUUID(), values, recordIds };
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

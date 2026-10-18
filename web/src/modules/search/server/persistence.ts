import { YAML } from 'bun';
import { WorkspaceFiles, StorageError, digest } from '@/shared/server/workspace-files';
import { configFileSchema, draftFileSchema, type PreferencesSnapshot } from '../model/contracts';
import { preferencesDraftSchema, searchPreferencesSchema } from '../model/schema';
import { toPreferences } from '../model/form-model';

export class PreferencesRepository {
	private constructor(private files: WorkspaceFiles) {}
	get workspace() {
		return this.files.workspace;
	}
	static async open(workspace: string) {
		return new PreferencesRepository(await WorkspaceFiles.open(workspace, 'search-preferences'));
	}
	private async snapshot(): Promise<PreferencesSnapshot> {
		const [configText, draftText] = await Promise.all([
			this.files.read('config.yaml'),
			this.files.read('draft.yaml'),
		]);
		const saved = configText === null ? null : configFileSchema.parse(YAML.parse(configText));
		let draft = draftText === null ? null : draftFileSchema.parse(YAML.parse(draftText)).draft;
		if (saved?.publication?.draftId && saved.publication.draftId === draft?.id) draft = null;
		return {
			preferences: saved?.preferences ?? null,
			draft,
			revision: digest(JSON.stringify([configText, draftText])),
		};
	}
	load() {
		return this.files.lock(() => this.snapshot());
	}
	private async change(expected: string, operation: (current: PreferencesSnapshot) => Promise<void>) {
		return this.files.lock(async () => {
			const current = await this.snapshot();
			if (current.revision !== expected)
				throw new StorageError(
					'conflict',
					'Preferences changed in another tab or on disk. Your edits are retained; reload to review current data.',
				);
			await operation(current);
			return this.snapshot();
		});
	}
	async edit(values: unknown, revision: string) {
		const parsed = preferencesDraftSchema.parse(values);
		return this.change(revision, async (current) => {
			await this.files.write('draft.yaml', {
				schemaVersion: 1,
				draft: { id: current.draft?.id ?? crypto.randomUUID(), values: parsed },
			});
		});
	}
	async publish(values: unknown, revision: string) {
		const preferences = searchPreferencesSchema.parse(toPreferences(preferencesDraftSchema.parse(values)));
		return this.change(revision, async (current) => {
			await this.files.write('config.yaml', {
				schemaVersion: 1,
				preferences,
				publication: { draftId: current.draft?.id ?? null },
			});
			try {
				await this.files.write('draft.yaml', { schemaVersion: 1, draft: null });
			} catch {
				/* The committed publication marker prevents recovery of the saved draft. */
			}
		});
	}
	discard(revision: string) {
		return this.change(revision, async () => {
			await this.files.write('draft.yaml', { schemaVersion: 1, draft: null });
		});
	}
}

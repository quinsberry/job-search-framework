import { WorkspaceFiles, StorageError } from '@/shared/server/workspace-files';
import {
	applicationsFileSchema,
	changesSchemas,
	manualInputSchema,
	type Application,
	type FoundApplication,
	type ListState,
	type ManualInput,
} from '../model/contracts';
import { manualFingerprint } from './fingerprint';

export const LIST = 'applications.json';
const notFound = () => Object.assign(new Error('This application no longer exists.'), { code: 'not-found' });
const duplicate = () => new StorageError('conflict', 'This vacancy is already in your applications.');

// The job seeker's rows. Each change locks, re-reads and rewrites the file, so a running search and
// edits made meanwhile never overwrite each other.
export class ApplicationList {
	private constructor(private files: WorkspaceFiles) {}
	static async open(workspace: string) {
		return new ApplicationList(await WorkspaceFiles.open(workspace, 'applications'));
	}
	async #read(): Promise<ListState> {
		const text = await this.files.read(LIST);
		return text === null ? { applications: [], deleted: [] } : applicationsFileSchema.parse(JSON.parse(text));
	}
	async list(): Promise<Application[]> {
		return (await this.#read()).applications;
	}
	// Deleted rows count as known, so the workflow skips them like listed ones.
	async has(fingerprint: string) {
		const { applications, deleted } = await this.#read();
		return deleted.includes(fingerprint) || applications.some((row) => row.fingerprint === fingerprint);
	}
	async #change<T>(apply: (state: ListState) => { state: ListState; result: T }): Promise<T> {
		return this.files.lock(async () => {
			const { state, result } = apply(await this.#read());
			await this.files.writeBytes(
				LIST,
				JSON.stringify(applicationsFileSchema.parse({ schemaVersion: 3, ...state }), null, 2),
			);
			return result;
		});
	}
	// The workflow's entry point: a found vacancy starts as `new` with no expected salary.
	add(found: FoundApplication) {
		return this.#insert({ origin: 'search', status: 'new', expectedSalary: null, ...found });
	}
	async addManual(value: ManualInput, now: Date) {
		const input = manualInputSchema.parse(value);
		return this.#insert({
			origin: 'manual',
			...input,
			fingerprint: manualFingerprint(input),
			addedAt: now.toISOString(),
		});
	}
	// Adding a deleted vacancy back by hand undoes its deletion.
	#insert<T extends Application>(row: T) {
		return this.#change(({ applications, deleted }) => {
			if (applications.some((item) => item.fingerprint === row.fingerprint)) throw duplicate();
			return {
				state: {
					applications: [...applications, row],
					deleted: deleted.filter((id) => id !== row.fingerprint),
				},
				result: row,
			};
		});
	}
	update(fingerprint: string, changes: unknown) {
		return this.#change(({ applications, deleted }) => {
			const current = applications.find((row) => row.fingerprint === fingerprint);
			if (!current) throw notFound();
			const next = { ...current, ...changesSchemas[current.origin].parse(changes) } as Application;
			if (next.origin === 'manual') next.fingerprint = manualFingerprint(next);
			if (applications.some((row) => row !== current && row.fingerprint === next.fingerprint)) throw duplicate();
			return {
				state: { applications: applications.map((row) => (row === current ? next : row)), deleted },
				result: next,
			};
		});
	}
	remove(fingerprint: string) {
		return this.#change(({ applications, deleted }) => {
			if (!applications.some((row) => row.fingerprint === fingerprint)) throw notFound();
			return {
				state: {
					applications: applications.filter((row) => row.fingerprint !== fingerprint),
					deleted: [...deleted, fingerprint],
				},
				result: undefined,
			};
		});
	}
}

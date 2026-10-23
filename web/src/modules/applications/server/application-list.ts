import { WorkspaceFiles, StorageError } from '@/shared/server/workspace-files';
import {
	applicationsFileSchema,
	changesSchemas,
	manualInputSchema,
	type Application,
	type FoundApplication,
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
	async list(): Promise<Application[]> {
		const text = await this.files.read(LIST);
		return text === null ? [] : applicationsFileSchema.parse(JSON.parse(text)).applications;
	}
	async has(fingerprint: string) {
		return (await this.list()).some((row) => row.fingerprint === fingerprint);
	}
	async #change<T>(apply: (rows: Application[]) => { rows: Application[]; result: T }): Promise<T> {
		return this.files.lock(async () => {
			const { rows, result } = apply(await this.list());
			await this.files.writeBytes(
				LIST,
				JSON.stringify(applicationsFileSchema.parse({ schemaVersion: 2, applications: rows }), null, 2),
			);
			return result;
		});
	}
	// The workflow's entry point: a found vacancy starts as `new` with no expected salary.
	add(found: FoundApplication) {
		return this.#insert({ origin: 'search', status: 'new', expectedSalary: null, ...found });
	}
	addManual(value: ManualInput, now: Date) {
		const input = manualInputSchema.parse(value);
		return this.#insert({
			origin: 'manual',
			...input,
			fingerprint: manualFingerprint(input),
			addedAt: now.toISOString(),
		});
	}
	#insert<T extends Application>(row: T) {
		return this.#change((rows) => {
			if (rows.some((item) => item.fingerprint === row.fingerprint)) throw duplicate();
			return { rows: [...rows, row], result: row };
		});
	}
	update(fingerprint: string, changes: unknown) {
		return this.#change((rows) => {
			const current = rows.find((row) => row.fingerprint === fingerprint);
			if (!current) throw notFound();
			const next = { ...current, ...changesSchemas[current.origin].parse(changes) } as Application;
			if (next.origin === 'manual') next.fingerprint = manualFingerprint(next);
			if (rows.some((row) => row !== current && row.fingerprint === next.fingerprint)) throw duplicate();
			return { rows: rows.map((row) => (row === current ? next : row)), result: next };
		});
	}
	remove(fingerprint: string) {
		return this.#change((rows) => {
			if (!rows.some((row) => row.fingerprint === fingerprint)) throw notFound();
			return { rows: rows.filter((row) => row.fingerprint !== fingerprint), result: undefined };
		});
	}
}

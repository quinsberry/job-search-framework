import type { z } from 'zod';
import { WorkspaceFiles } from '@/shared/server/workspace-files';
import {
	applicationsFileSchema,
	inspectedEntrySchema,
	type Application,
	type InspectedEntry,
} from '../model/contracts';

const INDEX = 'inspected.jsonl';
const APPLICATIONS = 'applications.json';
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const line = (entry: InspectedEntry) => JSON.stringify(entry) + '\n';

// Each inspected vacancy lives in exactly one file: rejections in the index, applications in their own file.
export class ApplicationStore {
	#applications: Application[] = [];
	#known = new Set<string>();
	private constructor(private files: WorkspaceFiles) {}
	static async open(workspace: string) {
		return new ApplicationStore(await WorkspaceFiles.open(workspace, 'applications'));
	}
	get workspace() {
		return this.files.workspace;
	}
	lock<T>(action: () => Promise<T>) {
		return this.files.lock(action);
	}
	async list(): Promise<Application[]> {
		const text = await this.files.read(APPLICATIONS);
		return text === null ? [] : applicationsFileSchema.parse(JSON.parse(text)).applications;
	}
	async #index(): Promise<InspectedEntry[]> {
		const lines = (await this.files.read(INDEX))?.split('\n') ?? [];
		if (lines.at(-1) === '') lines.pop();
		return lines.flatMap((text, index) => {
			try {
				return [inspectedEntrySchema.parse(JSON.parse(text))];
			} catch (error) {
				// An interrupted append leaves at most one partial last line.
				if (index === lines.length - 1) return [];
				throw error;
			}
		});
	}
	// Prunes rejections that are stale or were judged under other criteria; call once per run, under the lock.
	async prepare(criteriaDigest: string, now: Date) {
		this.#applications = await this.list();
		const kept = (await this.#index()).filter(
			(entry) =>
				entry.criteriaDigest === criteriaDigest &&
				now.getTime() - Date.parse(entry.inspectedAt) <= RETENTION_MS,
		);
		await this.files.writeBytes(INDEX, kept.map(line).join(''));
		this.#known = new Set([...this.#applications, ...kept].map((item) => item.fingerprint));
	}
	has(fingerprint: string) {
		return this.#known.has(fingerprint);
	}
	async reject(entry: z.input<typeof inspectedEntrySchema>) {
		await this.files.append(INDEX, line(inspectedEntrySchema.parse(entry)));
		this.#known.add(entry.fingerprint);
	}
	async add(application: Application) {
		const applications = [...this.#applications, application];
		await this.files.writeBytes(
			APPLICATIONS,
			JSON.stringify(applicationsFileSchema.parse({ schemaVersion: 1, applications }), null, 2),
		);
		this.#applications = applications;
		this.#known.add(application.fingerprint);
	}
}

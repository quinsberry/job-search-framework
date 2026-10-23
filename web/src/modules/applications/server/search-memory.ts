import type { z } from 'zod';
import { WorkspaceFiles } from '@/shared/server/workspace-files';
import { inspectedEntrySchema, type InspectedEntry } from '../model/contracts';

export const MEMORY = 'search-runs';
export const INDEX = 'inspected.jsonl';
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
export const line = (entry: InspectedEntry) => JSON.stringify(entry) + '\n';

// An interrupted append leaves at most one partial last line; anything else malformed is an error.
export function parseIndex(text: string | null): InspectedEntry[] {
	const lines = text?.split('\n') ?? [];
	if (lines.at(-1) === '') lines.pop();
	return lines.flatMap((text, index) => {
		try {
			return [inspectedEntrySchema.parse(JSON.parse(text))];
		} catch (error) {
			if (index === lines.length - 1) return [];
			throw error;
		}
	});
}

// Every vacancy the search has judged; the workflow alone writes it, holding the lock for the whole run.
export class SearchMemory {
	#known = new Set<string>();
	private constructor(private files: WorkspaceFiles) {}
	static async open(workspace: string) {
		return new SearchMemory(await WorkspaceFiles.open(workspace, MEMORY));
	}
	lock<T>(action: () => Promise<T>) {
		return this.files.lock(action);
	}
	// Rejections judged under other criteria or older than 60 days are forgotten; accepted vacancies never are.
	async prepare(criteriaDigest: string, now: Date) {
		const kept = parseIndex(await this.files.read(INDEX)).filter(
			(entry) =>
				entry.outcome === 'accepted' ||
				(entry.criteriaDigest === criteriaDigest &&
					now.getTime() - Date.parse(entry.inspectedAt) <= RETENTION_MS),
		);
		await this.files.writeBytes(INDEX, kept.map(line).join(''));
		this.#known = new Set(kept.map((entry) => entry.fingerprint));
	}
	has(fingerprint: string) {
		return this.#known.has(fingerprint);
	}
	async record(entry: z.input<typeof inspectedEntrySchema>) {
		await this.files.append(INDEX, line(inspectedEntrySchema.parse(entry)));
		this.#known.add(entry.fingerprint);
	}
}

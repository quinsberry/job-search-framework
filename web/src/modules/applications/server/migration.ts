import { WorkspaceFiles } from '@/shared/server/workspace-files';
import { applicationsFileSchema, applicationsFileV1Schema, type InspectedEntry } from '../model/contracts';
import { LIST } from './application-list';
import { INDEX, MEMORY, line, parseIndex } from './search-memory';

// Accepted entries are never pruned, so their digest is never compared.
const ACCEPTED_DIGEST = '0'.repeat(64);

// Before search memory and the list were separate, `applications/` held the index and a v1 list.
// Moves the index, remembers every v1 application as accepted, then upgrades the list; rerunning is harmless.
export async function migrateWorkspace(workspace: string) {
	const list = await WorkspaceFiles.open(workspace, 'applications');
	const memory = await WorkspaceFiles.open(workspace, MEMORY);
	const v1 = async () => {
		const text = await list.read(LIST);
		const value: unknown = text === null ? null : JSON.parse(text);
		return (value as { schemaVersion?: unknown } | null)?.schemaVersion === 1
			? applicationsFileV1Schema.parse(value)
			: null;
	};
	if ((await list.read(INDEX)) === null && !(await v1())) return;
	// Same order as a run (memory, then list), so the two never wait on each other in reverse.
	await memory.lock(() =>
		list.lock(async () => {
			const old = await v1();
			const accepted: InspectedEntry[] = (old?.applications ?? []).map((item) => ({
				fingerprint: item.fingerprint,
				outcome: 'accepted',
				failed: [],
				criteriaDigest: ACCEPTED_DIGEST,
				inspectedAt: item.matchedAt,
				ref: { sourceId: item.job.sourceId, sourceJobId: item.job.sourceJobId, url: item.job.url },
			}));
			// Memory first: an interruption after this step only repeats lines on the next attempt.
			const entries = [
				...parseIndex(await memory.read(INDEX)),
				...parseIndex(await list.read(INDEX)),
				...accepted,
			];
			if (entries.length) await memory.writeBytes(INDEX, entries.map(line).join(''));
			if (old) {
				const applications = old.applications.map(({ matchedAt, ...item }) => ({
					origin: 'search' as const,
					status: 'new' as const,
					expectedSalary: null,
					addedAt: matchedAt,
					...item,
				}));
				await list.writeBytes(
					LIST,
					JSON.stringify(applicationsFileSchema.parse({ schemaVersion: 2, applications }), null, 2),
				);
			}
			await list.remove(INDEX);
		}),
	);
}

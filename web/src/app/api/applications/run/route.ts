import { errorResponse, readLocalBody } from '@/shared/http/server';
import { listSearchSources, SearchRun } from '@/shared/search-sources/server/search.service';
import { runRequestSchema } from '@/modules/applications/model/contracts';
import { criteriaDigest } from '@/modules/applications/server/fingerprint';
import { ApplicationList } from '@/modules/applications/server/application-list';
import { migrateWorkspace } from '@/modules/applications/server/migration';
import { SearchMemory } from '@/modules/applications/server/search-memory';
import { runSearch } from '@/modules/applications/server/workflow';
import { PreferencesRepository } from '@/modules/search/server/persistence';
import { DecisionModelClient } from '@/modules/search/server/matching/decision-model';
import { MATCHING_RULES_VERSION, matchJob } from '@/modules/search/server/matching/match';
import { ProfileRepository } from '@/modules/profile/server/persistence';

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

// Composition root of the search workflow: reads saved criteria, wires sources and the matcher, streams NDJSON events.
export async function POST(request: Request) {
	try {
		const { workspace } = runRequestSchema.parse(await (await readLocalBody(request)).json());
		const { preferences } = await (await PreferencesRepository.open(workspace)).load();
		if (!preferences) throw coded('invalid', 'Save your search preferences before running a search.');
		const skills = (await (await ProfileRepository.open(workspace)).load()).profile?.skills ?? [];
		if (preferences.settings.minSkillMatch !== undefined && !skills.length)
			throw coded('invalid', 'Add skills to your profile or clear the skill match threshold');
		if (!process.env.OPENROUTER_API_KEY?.trim())
			throw coded('unavailable', 'Set OPENROUTER_API_KEY to run a search.');
		await migrateWorkspace(workspace);
		const memory = await SearchMemory.open(workspace);
		const list = await ApplicationList.open(workspace);

		// Only search memory is locked for the run; the list locks per write so edits keep working.
		// lock() releases when its action settles, so hold it until the stream ends; a busy lock answers 409.
		const finished = Promise.withResolvers<void>();
		const acquired = Promise.withResolvers<void>();
		const locked = memory.lock(async () => {
			acquired.resolve();
			await finished.promise;
		});
		locked.catch(() => {});
		await Promise.race([acquired.promise, locked]);

		const controller = new AbortController();
		const abort = () => controller.abort(request.signal.reason);
		request.signal.addEventListener('abort', abort, { once: true });
		const sourceIds = listSearchSources().map((source) => source.id);
		const model = new DecisionModelClient();
		const events = runSearch(
			{ preferences, criteriaDigest: criteriaDigest(preferences, skills, MATCHING_RULES_VERSION, model.identity) },
			{
				openRun: (query, signal) => new SearchRun({ sourceIds, query }, signal),
				match: (detail, signal) => matchJob(detail, { preferences, skills }, { model }, signal),
				memory,
				list,
				now: () => new Date(),
			},
			controller.signal,
		);
		const encoder = new TextEncoder();
		let open = true;
		const stream = new ReadableStream<Uint8Array>({
			// Not awaited: a pending start() would hold back delivery until the run ends.
			start(output) {
				void (async () => {
					try {
						for await (const event of events)
							if (open) output.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
						if (open) output.close();
					} catch (error) {
						if (open) output.error(error);
					} finally {
						request.signal.removeEventListener('abort', abort);
						finished.resolve();
					}
				})();
			},
			// Fires when the client drops the response, even if the framework never aborts request.signal.
			cancel(reason) {
				open = false;
				controller.abort(reason);
			},
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'application/x-ndjson',
				'Cache-Control': 'no-store',
			},
		});
	} catch (error) {
		return errorResponse(error);
	}
}

# Job Search Framework web app

Local Bun/Next.js app for a job seeker: candidate profile, search preferences and vacancy acquisition. Decisions live in `../docs/adr/` (0005–0008); vocabulary in `../CONTEXT.md`.

## Run and check

```bash
bun run dev            # also: bun run build, bun run start
bun test               # deterministic; fictional workspaces, mocked AI, no live scraping
bunx tsc --noEmit
bun run lint
```

AI conversion needs either an installed Codex CLI with a ChatGPT login (`codex login`) or the Claude Code CLI with a Claude subscription login (`claude auth login`). Profile/preference editing works without it. The folder picker uses `osascript` on macOS, PowerShell on Windows and requires `zenity` on Linux.

Keep the Bun server running during conversion: server termination interrupts unfinished jobs, which then need explicit Retry. No hosted/serverless execution.

## Workspace storage

The app writes only its own namespaces in the selected workspace:

```text
candidate-profile/   profile.yaml, draft.yaml, sources/<sha256>.*, conversions/<sha256>/
search-preferences/  config.yaml, draft.yaml
search-runs/         inspected.jsonl (search memory)
applications/        applications.json (the application list)
```

- YAML is validated on every read/save; unknown fields or versions error rather than lose values. Save may rewrite comments/formatting.
- Edits go to `draft.yaml` (debounced recovery); only explicit Save publishes via atomic replacement. A `publication` marker in the published file stops an interrupted draft cleanup from resurrecting a saved draft.
- Revision checks protect against external edits and other tabs; observing a new revision never resets local values or silently adopts its write revision.
- Conversion stages are reused for identical source bytes, provider/CLI identity and extraction/schema/prompt version. Keep the cache key derivation and `text.txt`, `raw-output.yaml`, `result.yaml` formats unchanged, or users pay for reinterpretation; a deliberate change bumps the conversion version.

## Architecture rules

`app/workspace-content.tsx` composes the independent Workspace, Agent, Profile and Search modules and flushes both editors before switching workspaces.

ESLint enforces these boundaries:

- Feature modules under `src/modules/` don't import each other at runtime (type-only is fine); composition belongs in `app/`.
- Shared code never imports features.
- Outside `server/`, `server.ts`, `actions/` and tests, code cannot import server modules, Node built-ins or Bun.

Prefer Bun built-ins; exclusive file creation, atomic rename, directory locks and symlink checks keep Node APIs.

**Adding an AI provider**: adapter in `shared/ai/server/`, its ID in `shared/ai/contracts.ts`, registry entry and Agent metadata. Profile forms, recovery and persistence don't change.

## Vacancy acquisition

Server-only entry points: `listSearchSources` and `SearchRun` in `shared/search-sources/server/search.service.ts`. Construct a run with `new SearchRun({ sourceIds, query }, signal, optionalAdapters)`. A run keeps all continuation in memory: call `next(limit)` until `done`, inspect `batch.sources` for failures, and always `dispose()`. There is no persistence, restart resume, cache or cross-source identity inference. Acquisition never judges fit; filters are reported as applied, approximate or unsupported.

**Adding a source**: implement `SearchSourceAdapter` under `server/<source>/`, add its ID to `sourceIdSchema` and its adapter to the private registry in `server/search.service.ts` (checked for enum coverage). Validate cursors and external payloads, preserve overflow and source-owned IDs, never fetch arbitrary reference URLs, and add fixtures for parsing, access failures, pagination and cancellation. Adapters import only the portable contracts.

LinkedIn uses public guest HTML endpoints; upstream HTML changes can require parser updates. Its guest search ignores workplace filters and its pages omit the workplace type, so the adapter reports `workArrangements` as unsupported and leaves the arrangement to matching.

## Matching

`modules/search/server/matching/match.ts` exports `matchJob(detail, { preferences, skills }, { model }, signal)`. It runs structured checks first, then one decision request for unresolved criteria, and returns strict `match`, `no-match` or `needs-clarification` results with criterion evidence and reported cost. Evaluation/transport failures reject with `MatchError`; they never become rejection decisions. Salary is compared only from structured advertised pay in matching contract, currency and period units, never inferred from description text or converted between units.

A workplace outside the residence city fails location unless the vacancy is confirmed remote; LinkedIn's public pages do not state the workplace type, so this relies on the title and description.

The optional **Minimum skill match (%)** field accepts 1–100; empty skips the skills criterion. Older configs and recovery drafts remain valid. Required skill names compare after lowercasing/removing non-alphanumerics; no alias table is supplied. Structured lists currently count as must-have. With a threshold but no candidate skills, matching rejects with “Add skills to your profile or clear the skill match threshold”. The future workflow must check that before starting acquisition.

Production callers supply `new DecisionModelClient()` from `decision-model.ts`. It currently calls Jev (`typesafe/jev-1.14`) through `@typesafe-ai/sdk`, using the OpenRouter base URL and server-side `OPENROUTER_API_KEY`. The SDK owns HTTP, JSON decoding and retries; a fetch guard preserves the response-size limit and rejects Retry-After waits above two seconds. Responses still pass runtime Zod validation. Compression and SDK logging are disabled to keep the wire budget explicit and vacancy content out of logs. The [OpenRouter System One documentation](https://openrouter.ai/docs/guides/community/typesafe-sdk) defines its HTTP envelope; [TypeSafe's API reference](https://docs.typesafe.ai/api) defines typed answers. The model client maps an expected score over five coverage levels to 0–100. To replace the decision model, change only the implementation, `MODEL_ID` and input budget in `decision-model.ts`; callers and matching rules use neutral questions and answers. A model change alters the client's `identity`, so the next run judges stored rejections again once, at model cost.

All questions for a job share one context. The client allows 28,000 UTF-8 bytes for the neutral request, reserving space below the 32,000-byte wire budget. Oversized criteria reject before calling the model; descriptions are truncated to fit, making all model-derived criteria unknown. Probability bands are fixed at 0.2/0.8; model skill coverage uses a ±10-point band around the threshold. These rules have deterministic fake-model tests, but real matching accuracy and threshold calibration have not been measured. HTTP retries stop after three attempts, cap Retry-After waits at two seconds, bound response bodies and obey cancellation/deadlines.

Tests use fake decision models and mocked HTTP; no live model calls are needed.

## Search workflow

`POST /api/applications/run` `{ workspace }` runs a search and streams NDJSON `RunEvent`s (`started`, `progress`, `application`, `job-failed`, `source-failed`, then `done` with reason, totals, reported `costUsd` and `unpricedCalls`). Missing preferences, a skill threshold without profile skills, a missing `OPENROUTER_API_KEY` or a run already in progress (409) fail before streaming. Cancelling the request or the stream aborts the run. `POST /api/applications` takes `{ action, workspace, … }`: `load` returns the application list with the search sources' names; `add` (`row`), `update` (`fingerprint`, `changes`) and `delete` (`fingerprint`) change it, answering 409 for a duplicate and 404 for a row that is gone. All of them work during a run. On the client, use `useApplications` and `useSearchRun` from `modules/applications/client/queries.ts`.

`modules/applications/server/workflow.ts` owns the loop and receives acquisition, matching and storage as dependencies; `app/api/applications/run/route.ts` wires the real ones. It makes one query per position title (narrowed by country when remote is accepted, otherwise by city), alternates between titles and fetches and matches one vacancy at a time. It stops at `maxJobsToMatch` applications, `maxJobsToProcess` new vacancies, five times that many pulled summaries (`no-new` when none of them was new), or when sources run out.

Reruns skip known vacancies before fetching details. A vacancy's fingerprint is normalised company + title + first city (else country, else `remote`), or the source ID without a company; there are no alias tables. Search memory (`search-runs/inspected.jsonl`) records every judged vacancy with its outcome (`accepted`, `no-match`, `closed`), failed criterion names and the digest of the criteria that judged it. Rejections are pruned at run start when that digest changes or after 60 days; accepted vacancies never are, so a deleted application is not found again. The digest also covers two versions, each living with the code it covers: `MATCHING_RULES_VERSION` in `match.ts` (structured checks, question text, probability bands, thresholds), bumped when a matching change could alter earlier outcomes; and the decision model's `identity`, built in `decision-model.ts` from the model ID, the input budget and `FORMAT_VERSION`, which is bumped when question encoding or score mapping changes. Replacing the model or changing its budget changes the identity on its own. When the identity joined the digest, every workspace's digest changed once, so the first run afterwards judged all stored rejections again at model cost; accepted vacancies were kept.

The application list (`applications/applications.json`, schema v3; v2 remains readable) holds search rows (job without description, match evidence) and manual rows (URL, title, company, location, salary as text), each with a status and an expected salary. Expected salary accepts a structured amount, currency, period and contract type; existing free text stays readable until explicitly replaced or cleared. List mutations write schema v3; existing v1-to-v2 migration remains supported. A run locks only search memory; every list write takes the list's own lock and re-reads the file, so edits during a run are kept. Search rows may change status, expected salary and an optional work-arrangement override; manual rows may also change their facts, which recomputes their fingerprint. Original search facts and assessments are preserved; derived manual resolutions are never written to the list. Workspaces from before the split migrate on first use (`server/migration.ts`). Model outages and rate limits stop a run; other per-vacancy failures are reported and retried next run.

## Applications

`modules/applications/applications-section.tsx` shows the open workspace's applications under the search preferences. **Search** starts a run and becomes **Cancel** while it streams; the status line shows inspected, found and skipped counts against the budgets, then a summary with the stop reason, reported cost and failures. New applications appear as they are found.

The table lists title (linking to the posting), status, company, location, work arrangement, salary, expected salary, outcome, open questions and the found date; employer salary, source and published date are in **View**, hidden by default. Expand a row to see each criterion's result, evidence and detail. Change a status inline; the ⋯ menu edits a row (search rows: status, expected salary and work arrangement; manual rows: their facts too) or deletes it after a confirmation. **Add application** tracks a vacancy found elsewhere; it is not matched. The status filter shows Active rows (new, applied, interviewing, offer) by default. Display rules live in `application-table/rows.ts`: matches and manual rows sort first, then rows with fewer open questions. An unadvertised salary is shown muted rather than as an open question, since most sources omit pay. The arrangement falls back to the model's most likely answer when the source does not state it.


### Manual resolutions

A search row's edit dialog can confirm one or more work arrangements. This resolves only the arrangement criterion, shows a **Manual** badge in the expanded details and updates the arrangement shown in the table; it does not compare arrangements against preferences or rerun location checks. **Reset to original** restores the original arrangement, evidence and result.

Structured Expected salary resolves an existing salary criterion when the amount reaches any saved minimum with the same currency, pay period and contract type. Desired salary is not a ceiling. This is a deterministic local check, without conversion or AI calls; it does not claim the employer offers that pay. Legacy free text does not qualify automatically. Clearing the value or making it incompatible restores the original salary assessment. Manual rows remain **Added manually**.

`modules/applications/model/manual-assessment.ts` owns the pure projection from original assessments and user inputs to effective criteria and Outcome. The applications load route supplies one snapshot of published salary bands to all rows; drafts never count. Outcome and Open questions use effective criteria, so other unknowns still keep **Needs clarification**. Missing advertised salary retains its existing outcome effect until manually resolved.

Saving preferences refreshes the applications query through composition in `app/`; preference storage never rewrites applications. Each reload recalculates from the current published bands. Application refresh failures are shown separately from a successful preferences save. Original matching results for other criteria remain snapshots of the search that found the vacancy.

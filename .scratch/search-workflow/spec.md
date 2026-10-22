# Search workflow

Status: ready-for-agent. Tracked as `issues/01-search-workflow-store-routes.md`.

## Objective and scope

Turn the saved search configuration into stored applications: acquire vacancies from the selected sources, skip vacancies already inspected, match the rest and keep `match` and `needs-clarification` results for the job seeker. Runs stream progress to the client and can be cancelled.

In scope: the run loop and budgets, the inspected-vacancy index and application store, two HTTP routes, two client hooks, tests and docs. Out of scope, next spec: the applications table, its columns, the "Run search" control, and job-seeker statuses (applied, dismissed). Background jobs that survive a closed tab, `publishedAfter` incremental runs, cross-source alias tables and lifetime spend tracking are deferred.

## Module layout (low coupling, high cohesion)

```text
web/src/modules/applications/
  model/contracts.ts        Zod schemas: application record, index entry, run events, requests
  server/fingerprint.ts     pure: normalisation, vacancy fingerprint, criteria digest
  server/store.ts           ApplicationStore: index + applications files, no matching or acquisition
  server/workflow.ts        runSearch: the loop, budgets, failure policy; all I/O injected
  client/api.ts             load + NDJSON stream reader
  client/queries.ts         useApplications, useSearchRun
  application-table/        existing UI, untouched by this spec
web/src/app/api/applications/route.ts       load (JSON)
web/src/app/api/applications/run/route.ts   run (NDJSON stream); the composition root
```

- `workflow.ts` imports only types and pure helpers. Acquisition, matching and storage come in as dependencies, so tests need no network, model or repository wiring.
- The run route is the only place that wires real parts together: it reads the saved preferences (`PreferencesRepository`) and the saved profile's skills (`ProfileRepository`), builds `SearchRun`s and `DecisionModelClient`, and opens the store.
- Search, Profile and search-sources never import Applications. Applications never reaches into their internals; it uses their public `server` entry points and contracts.
- `store.ts` knows file formats and pruning rules but not how a vacancy is matched; `fingerprint.ts` knows identity but not storage.

## Interface

```ts
// server/workflow.ts
type RunDeps = {
  openRun(query: DiscoveryQuery, signal: AbortSignal): SearchSourceRun; // one per position title; sources bound by the route
  match(detail: JobDetail, signal: AbortSignal): Promise<MatchResult>;   // matchJob with criteria bound
  store: ApplicationStore;
  now(): Date;
};
runSearch(
  input: { preferences: SearchPreferences; criteriaDigest: string },
  deps: RunDeps,
  signal: AbortSignal,
): AsyncIterable<RunEvent>;

type RunEvent =
  | { type: 'started'; budgets: { process: number; match: number } }
  | { type: 'progress'; processed: number; matched: number; skipped: number }
  | { type: 'application'; record: Application }
  | { type: 'job-failed'; ref: JobRef; code: MatchErrorCode | SourceErrorCode }
  | { type: 'source-failed'; sourceId: SourceId; error: SourceFailure }
  | {
      type: 'done';
      reason: 'match-budget' | 'process-budget' | 'exhausted' | 'cancelled' | 'failed';
      totals: { processed: number; matched: number; skipped: number };
      costUsd: number;          // reported cost: sum of non-null MatchResult.costUsd in this run
      unpricedCalls: number;    // model calls with unknown cost: a result with a `model` criterion and null cost, or a failed model call
      error?: { code: string; message: string };
    };
```

## Run loop

1. **Preflight, before the stream opens** (plain JSON error with HTTP status): workspace valid; saved preferences exist; `OPENROUTER_API_KEY` present; `minSkillMatch` set with an empty skill list is rejected with "Add skills to your profile or clear the skill match threshold"; the store lock is free (`conflict`, 409).
2. **Queries**: one `DiscoveryQuery` per `positionTitles` entry, `query` = the title. `location` = `country` when remote is accepted (a remote job listed in another city must still be found), else "city, country"; omitted for remote-only with no residence. `workArrangements` passed through. Seniority, salary and position type are left to the matcher. No `publishedAfter`.
3. **Acquisition**: title runs alternate round-robin. Each pull is `next(min(25, remaining process budget))`. Details are fetched and matched one vacancy at a time, no concurrency.
4. **Per summary**: compute the fingerprint. Already known (in the index, in `applications.json`, or earlier in this run) → `skipped`, no detail fetch, no budget use. Otherwise it counts toward `maxJobsToProcess`, then:
   - detail failure → `job-failed`, not recorded, retried next run;
   - `availability: 'closed'` → recorded as `closed`, no model call;
   - otherwise `match()`; `no-match` is appended to the index; `match`/`needs-clarification` are written to `applications.json` only, and emit `application`.
5. **Stop** at the first of: `maxJobsToMatch` applications this run (`match` + `needs-clarification`), `maxJobsToProcess` processed, `5 × maxJobsToProcess` summaries pulled (reported as `process-budget`), all title runs done, cancellation. The pull cap keeps reruns, where most results are already known, from paging through every source page.

## Failure policy

| Failure | Effect |
| --- | --- |
| Missing preferences, missing key, `MatchError` `invalid-input`, lock taken | Preflight error, no stream |
| `MatchError` `unavailable` or `rate-limited` | Run ends: `done { reason: 'failed' }` |
| `MatchError` `timeout`, `network`, `invalid-response`; detail fetch failure | `job-failed`; vacancy not recorded; counts as processed |
| A source fails inside a title run | `source-failed`; other title runs continue |
| Request aborted | `SearchRun`s and the model call cancel; `done { reason: 'cancelled' }` if the stream is still open |
| Store write fails | Run ends: `done { reason: 'failed' }` |

## Vacancy identity

`fingerprint = sha256(company | title | place)` over normalised `JobSummary` fields, so the check happens before the detail fetch.

- Normalise: lowercase, NFKD with diacritics removed, non-alphanumerics to spaces, collapse spaces.
- Company also drops trailing legal suffixes: `inc`, `ltd`, `llc`, `gmbh`, `sp z o o`, `s a`.
- Place is `locations[0].city ?? locations[0].country ?? 'remote'`. Seniority words stay in the title ("Senior X" ≠ "X").
- `company` null → fall back to `sourceId:sourceJobId`; cross-source merging is unsafe without a company.
- `shortcut: no city or company alias tables (Warszawa ≠ Warsaw); a miss costs one extra inspection, never a lost vacancy.`

`criteriaDigest = sha256(JSON of MATCHING_RULES_VERSION, targetPosition, minSkillMatch, sorted normalised skills)`; the run route passes the version from matching. Queries are built in `server/queries.ts`. Budget settings are excluded.

## Storage

Files live under `<workspace>/applications/` through `WorkspaceFiles`. Add JSON support to it if it only writes YAML.

A vacancy is known when its fingerprint is in either file. Each inspected vacancy is written to exactly one file, so there is no two-file write to get out of step.

**`inspected.jsonl`**: the dedup index of rejected vacancies, one line each:

```ts
type InspectedEntry = {
  fingerprint: string;
  outcome: 'no-match' | 'closed';
  failed: Criterion[];                    // names of failed criteria; closed → ['availability']
  criteriaDigest: string;
  inspectedAt: string;                    // ISO datetime
  ref: JobRef;
};
```

- Loaded once per run into a `Map` by fingerprint. A malformed last line (interrupted append) is ignored; other malformed lines are an error.
- At run start, pruned and rewritten once (which also drops an interrupted last line): drop entries whose `criteriaDigest` differs from the current one, and entries older than 60 days.
- During the run, each inspected vacancy is appended as one line.

**`applications.json`**: the table's data, `{ schemaVersion: 1, applications: Application[] }`:

```ts
type Application = {
  fingerprint: string;
  job: Omit<JobDetail, 'description'>;    // the URL links to the full posting
  match: MatchResult;                     // outcome, criteria evidence, costUsd
  matchedAt: string;
};
```

- Rewritten atomically on each new application. Applications are never pruned or re-evaluated automatically, so they are never re-inspected or duplicated.

**Locking**: a run holds the store lock for its whole duration. `WorkspaceFiles.lock(action)` releases when `action` settles, so the route calls `lock(() => runFinished)`, waits for a signal raised inside the callback, and only then opens the stream; if `lock` rejects with `conflict` (after its ~2 s retry window) the route answers 409 instead. `load` does not take the lock: both files are read-only for it and `applications.json` is replaced atomically.

## HTTP

- `POST /api/applications` `{ action: 'load', workspace }` → `{ applications }` via `localRequest`.
- `POST /api/applications/run` `{ workspace }` → `application/x-ndjson`, one `RunEvent` per line, `Cache-Control: no-store`. It applies the same local-origin and body checks as `localRequest` (factor the guard out of `shared/http/server.ts`). Preflight failures use `localRequest`'s error shape and status codes. The run's `AbortController` is aborted by both `request.signal` and the response `ReadableStream`'s `cancel()` callback, so a dropped client stops the run even if the framework does not fire `request.signal` for streamed responses.

## Client

- `useApplications(workspace)`: React Query `load`.
- `useSearchRun(workspace)` → `{ start, cancel, status: 'idle' | 'running' | 'done' | 'failed', progress, lastDone }`. Reads the NDJSON stream with a line splitter, validates each event with Zod, and invalidates the applications query on each `application` event and on `done`.

No UI in this spec.

## Required checks

All with fake `SearchSourceRun`s, a fake `match` and a temp workspace; no live network or model calls.

- Fingerprint: normalisation, legal suffixes, diacritics, null-company fallback, city → country → `remote` place; same vacancy from two fake sources is inspected once.
- Query: remote + hybrid sends `country` only; hybrid/on-site only sends "city, country".
- Criteria digest changes with target position, `minSkillMatch` or skills, not with budgets.
- Round-robin across two titles; a vacancy seen under both titles is processed once.
- Budgets: stops at `maxJobsToMatch` (counting `needs-clarification`), at `maxJobsToProcess`, and on exhaustion; skipped vacancies use no budget and trigger no detail fetch or `match` call; a source of only known vacancies stops at the `5 × maxJobsToProcess` pull cap.
- Closed vacancies are recorded without calling `match`.
- Failure policy table, row by row, including `source-failed` with other titles continuing.
- Cancellation mid-run stops acquisition and matching and leaves both files valid.
- Rerun: previously inspected vacancies and existing applications are skipped; a changed digest re-inspects old `no-match`/`closed` but not applications; 60-day expiry; a truncated last JSONL line is ignored.
- A crash between inspection and write leaves the vacancy unknown (re-inspected next run), never known-but-missing.
- `costUsd` sums reported costs; `unpricedCalls` counts failed model calls and null costs with a `model` criterion, but not structured `no-match` results.
- Routes: preflight errors and status codes, cancelling the response stream aborts the run, a second run started while the first is still streaming → 409, stream emits valid events ending in `done`, `load` works during a run.
- `useSearchRun` parses a split NDJSON stream and invalidates the applications query.

## Docs

- ADR 0009: search workflow — streamed runs, fingerprint dedup before detail fetch, rejected-vacancy index vs application store, pull cap, criteria-digest invalidation, failure policy.
- `CONTEXT.md`: add **Application** (a vacancy that reached `match` or `needs-clarification`, kept for the job seeker to review and act on; applying is a later status, not implied) and **Inspected vacancy** (a fingerprinted vacancy the workflow has already evaluated; rejected ones are evaluated again after the search criteria change or after 60 days, applications never are). Note that the existing _Avoid: inspected listing_ under **Qualifying vacancy** still holds: an inspected vacancy is not a qualifying one.
- `web/README.md`: a short Search workflow section — routes, stream events, files under `applications/`, how reruns skip work.

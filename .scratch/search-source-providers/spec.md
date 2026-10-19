# Search-source adapters and acquisition facade

Status: ready-for-agent. Approved for implementation, tracked as `issues/01-core-contracts-linkedin-facade.md` and `issues/02-justjoin-adapter.md`.

## Objective and scope

Give the independent Bun/Next.js app one typed interface for acquiring vacancies from several selected sources. Adding a source requires its self-contained adapter, one source ID enum value and one server registry entry, without source-specific branches in the app, matcher or UI.

Planned sources are LinkedIn, JustJoin, NoFluffJobs and, later, Indeed. Implement the shared contract, registry, run-scoped facade, adaptation of the existing LinkedIn implementation and a JustJoin adapter as the second real source. JustJoin is a separate ticket so a negative endpoint-research result does not block the rest. Check the model against NoFluffJobs data, but do not implement its network adapter in this change. Indeed is deferred: its public publisher API is discontinued and its pages are bot-protected, so whether it needs a browser runtime is decided in its own adapter spec without changing this contract. Define the future matcher seam in this plan; Jev integration and the app search workflow are follow-up work.

`web/src/shared/search-sources/` contains a provisional contract and LinkedIn search/detail/helpers, with no callers elsewhere in `web/src` or the web README. Its current options expose LinkedIn-specific pagination/age concepts, search and detail return JSON strings, and the contract lacks detail retrieval. Preserve useful parsing behavior while replacing these unused internal interfaces; compatibility wrappers are unnecessary unless a real caller is found before implementation.

## Ownership and dependency direction

| Module | Owns | Must not own |
| --- | --- | --- |
| App search workflow, later | Build discovery queries, request batches/details, call matcher, count qualifying results, stop at inspection/result budgets, save results and show progress | Source URL syntax, HTML parsing, Jev response parsing |
| Search-source facade | Resolve selected adapters, combine pages fairly, exact within-source deduplication, per-source progress/failures, acquisition lifecycle | Fit decisions, ranking, AI, profile/preferences persistence, application tracking |
| Source adapter | Its requests, native pagination, filter translation, parsing, normalized summaries/details and source-owned identity | Other adapters, app workflow, candidate facts, matching criteria or AI |
| Job matcher, later | Evaluate jobs against explicit criteria and relevant candidate facts; deterministic checks first, Jev for semantic decisions | Acquiring more pages, source-specific parsing or persistence |

The matcher receives normalized details plus criteria, not jobs alone. Its outcomes are `match`, `no-match` and `needs-clarification`; model/transport failures remain errors rather than rejection decisions. Within the search pipeline, AI belongs only to the matcher. Existing profile AI behavior is unrelated and unchanged.

The source module never imports `modules/search`, Profile, React, workspace persistence or AI implementations. Portable contracts contain serializable data and runtime validation. Server execution stays behind an explicit server entry point. Adapters depend on the shared contract; they never import the registry/facade. A later remote adapter can implement the same interface without changing consumers; no separate service deployment is introduced now.

## Agreed discovery input

- One nonempty plain-text `query` per run, with optional workplace search `location`, acceptable `workArrangements` and `publishedAfter`.
- The app workflow can issue multiple discovery queries for alternative desired position titles. It supplies suitable search location hints; residence is not automatically a vacancy eligibility rule.
- Location is a portable text hint, not a source-specific location ID. Arrangements use `remote`, `hybrid`, `on-site`; adapters map native spelling/flags. An adapter that must derive a country or regional site from the hint reports that as an approximation.
- `publishedAfter` is an absolute ISO timestamp, replacing competing day/minute fields. Adapters may translate it conservatively into native age windows, reporting approximations. A discovery filter is not proof a listing satisfies a matching criterion.
- Initial source filtering does not include salary, seniority or candidate-fit rules. Those belong to the future matcher. Source adapters report unsupported requested filters; they must not silently pretend to apply them. Multi-arrangement requests must not be narrowed to an arbitrary single arrangement.
- The caller selects registered source IDs explicitly. Do not silently substitute an unknown/unavailable source or select defaults.

## Proposed portable data contracts

Define strict Zod schemas and infer TypeScript types from them. Validate inputs, adapter cursors, adapter results and external responses. Bound strings, collection counts, page sizes and downloaded response bodies. Do not return `unknown`, JSON strings, raw HTML or source-specific response objects through the public interface.

| Contract | Fields and meaning |
| --- | --- |
| `SourceDescriptor` | `id` from `sourceIdSchema`, display `name`, supported discovery filters. It describes capabilities, not current network availability. |
| `DiscoveryQuery` | `query`, optional `location`, optional nonempty `workArrangements`, optional `publishedAfter`. |
| `JobRef` | `sourceId`, nonempty string `sourceJobId`, canonical HTTP(S) `url`. IDs need not be numeric. |
| `JobSummary` | Reference plus nonempty `title`, nullable company/name/URL, locations, nullable publication date and `observedAt`. |
| `JobDetail` | Reference and summary facts, nullable plain-text `description`, `availability`, optional advertised facts and their original text. Preserve original summary publication evidence if the detail page does not provide it; do not manufacture a publication date from expiry or observation time. |
| `SourcePage` | Validated summaries, source-owned opaque `nextCursor` or null, and requested-filter application reports. An adapter returns at most its requested limit. |
| `SearchBatch` | Combined summaries, `done` when no selected source can make further progress, and source reports identifying active/exhausted/failed sources, filter limitations and typed failures. |
| `DetailResult` | Discriminated success with validated `JobDetail`, or failure with original `JobRef` and typed error. |

Locations are a collection because a vacancy can advertise several. Retain a source location label and explicit structured city/country only when provided. Unknown arrangements/locations remain distinguishable from confirmed values; never substitute candidate residence. Job details may use `open`, `closed` or `unknown`; no closed banner is insufficient to establish `open`. A successful detail parse needs actual vacancy content, not a title placeholder produced from a consent/login/error page.

Optional advertised facts initially cover source-provided work arrangements, seniority/employment text, skills when explicitly structured, expiry and compensation. Preserve missing facts as explicit null/unknown values rather than inference. Plain-text description remains available for future semantic matching. Keep source raw text for facts whose normalized interpretation is incomplete; do not add an unrestricted vendor-data bag.

Advertised compensation is distinct from preference baseline/target salary: a source may genuinely advertise minimum and maximum pay, and JustJoin/NoFluffJobs often advertise several ranges per vacancy (for example B2B and permanent). Compensation is therefore a list of entries, each preserving original amounts, three-letter currency, `period`, `contractType` and original text. Reuse the preference vocabulary from `modules/search/model/schema.ts` so the matcher compares like with like: `contractType` is `permanent`, `B2B` or `unknown`; `period` is `annual`, `month`, `hourly` or `unknown`. Define these values in the portable contract rather than importing the search module. Currency support is not restricted to the current preferences editor's three currencies. Undisclosed pay is unknown. Do not replace native employer figures with a website's calculated monthly conversion or invent missing pay basis. No conversion or tax calculations occur here.

`observedAt` records acquisition time; source dates retain their known precision. Do not manufacture UTC time-of-day for a source that reports only a calendar date. Observation timestamps and availability are observations, not promises about the current live posting.

## Adapter and facade interfaces

The following signatures describe the intended small interface. Implement concrete schemas for the named data types rather than using caller-selected generics.

```ts
// Caller cancellation and deadline: AbortSignal.any([caller, AbortSignal.timeout(ms)]).
interface SearchSourceAdapter {
  readonly descriptor: SourceDescriptor;
  search(
    input: { query: DiscoveryQuery; limit: number; cursor?: string },
    signal: AbortSignal,
  ): Promise<SourcePage>;
  getDetail(ref: JobRef, signal: AbortSignal): Promise<DetailResult>;
}

interface SearchSourceRun {
  next(limit: number): Promise<SearchBatch>;
  getDetail(ref: JobRef): Promise<DetailResult>;
  dispose(): void;
}

// Server entry points; tests supply adapters through the same creation seam.
listSearchSources(): SourceDescriptor[];
createSearchSourceRun(
  input: { sourceIds: SourceId[]; query: DiscoveryQuery },
  signal: AbortSignal,
  adapters?: readonly SearchSourceAdapter[],
): SearchSourceRun;
```

The run-scoped facade binds the selected sources, immutable query and signal once. The run object holds all source cursors, buffers and progress in memory; callers just call `next(limit)` until `done`. Adapter cursors stay source-owned and never leave the run. `getDetail` dispatches by `sourceId` only and rejects references outside the selected registry. It constructs requests from adapter-validated identities; an untrusted reference URL must not turn into arbitrary server-side fetching.

The default registry supplies production adapters; explicit injected adapters make the facade independently testable without network calls. Mirror `shared/ai`: the portable contract declares `sourceIdSchema = z.enum([...])` listing implemented sources only, and the server registry is a map checked with `satisfies` so every enum value has an adapter. Adding a source is its adapter, one enum value and one registry entry, with no UI switch or readiness table. Unknown IDs fail input validation. A later UI reads metadata through its application transport; it never imports the server registry into a client bundle.

No mandatory `check()`, Connect action, AI-like `cacheIdentity`, source result cache or credential framework. Report access problems from actual acquisition. Credential setup can be added when an implemented source requires it.

## Pagination, fairness and run lifecycle

- Schedule selected sources round-robin, with bounded concurrency and deterministic merge order. A fast or large source must not consume the entire requested batch before other sources get turns. When the limit is smaller than the source count, continuation preserves whose turn comes next.
- The combined result count never exceeds the requested limit. A batch may be smaller because sources return fewer items, duplicates are removed or sources fail. Do not loop without bounds merely to fill a batch; acquire at most one new page per participating source in a combined call, with remaining work represented by continuation.
- Source page boundaries stay private. Native overflow must remain in a source cursor or run-private buffer; never slice a native page and skip the remainder. The facade must not accept an over-limit adapter response and silently discard its tail.
- Deduplicate by `(sourceId, sourceJobId)` throughout the run, including repeated native pages. Preserve source references. Do not infer cross-source identity from company/title/location similarity. Cross-source resolution is follow-up work.
- Keep pending buffers, seen IDs and progress private to the run, not in process-global caches. They are bounded by actual run work and page/input limits; release them on disposal/cancellation. The app's inspection budget bounds total acquisition when the future workflow is added.
- Continuation is the run object itself; there is no facade cursor to validate. Reject a `next()` call while another is in flight as `busy` so advancement is never duplicated.
- `done: true` means no more acquisition can proceed in this run, but callers must inspect source failures rather than assume every source exhausted successfully.
- No persisted run resumption or server restart survival. Live job boards can change between pages; continuation is not a frozen external snapshot. Exact deduplication prevents repeated identities but cannot guarantee exhaustive retrieval from a changing upstream source.
- Adapters must make progress: repeated cursors without new progress are invalid responses, not infinite continuation. Legitimate empty pages with a new continuation remain distinguishable from exhaustion. Source-specific empty-result markers, access-wall detection and parser fixtures establish how LinkedIn distinguishes these cases.

## Errors, retries and cancellation

Use typed operational codes, including `invalid-input`, `busy`, `blocked`, `rate-limited`, `timeout`, `network`, `not-found`, `invalid-response` and `unavailable`. Expected per-source failures are data in source reports/detail results. Invalid facade inputs and run-wide cancellation/deadline termination reject the operation with a typed error. Cancellation is not an empty successful result or vacancy closure.

Each adapter owns bounded retries for transient failures and honors applicable `Retry-After` up to its own maximum wait; a longer requested wait ends retries with `rate-limited`. Combine the run signal with per-request timeouts. The signal applies through body reading and retry waits, not just initial fetch. Prefer Bun built-ins in server code where appropriate; do not add dependencies for HTTP requests, timers or JSON validation.

After retry exhaustion, a failed search source is terminal for the current run; retain its earlier results/failure and continue other selected sources. Do not retry that source again on every combined page. A fresh run may retry it. Failure of one detail request stays attached to its reference and does not automatically disable the entire source. A 404, malformed response, CAPTCHA, login wall or failed fetch must not become `closed`, nor may a parser failure become successful zero results.

Run cancellation/disposal stops scheduling and aborts in-flight work; callers retain already-returned batches. Active operations do not publish a misleading successful batch after the run has been cancelled. `dispose()` releases run-private state and rejects subsequent acquisition. The run signal, including its deadline, applies to details as well as search pages; the future workflow derives it from its run deadline and budgets.

## Proposed files

```text
web/src/shared/search-sources/
  contracts.ts                    portable Zod schemas/types and errors
  server/
    providers.ts                  the one production adapter registry
    search-sources.ts             public creation/metadata entry points and run facade
    search-sources.test.ts         fake-adapter contract and orchestration tests
    linkedin/
      provider.ts                 descriptor and SearchSourceAdapter implementation
      search.ts                   LinkedIn query and native-page mechanics
      detail.ts                   reference validation and detail normalization
      helpers.ts                  source-specific parsing/HTTP helpers
      provider.test.ts            fixture-backed adapter tests
      fixtures/                   small fictional HTML cases
    justjoin/
      provider.ts                 descriptor, search/detail and normalization
      provider.test.ts            fixture-backed adapter tests
      fixtures/                   small fictional JSON cases
```

Move the existing LinkedIn files under `server/linkedin/` so execution is clearly separated from portable contracts and existing lint rules protect client imports. Keep responsibilities together; merge `provider.ts` into a nearby file if it becomes only a forwarding wrapper. Do not extract a generic scraping framework or shared network module until a second implemented adapter actually needs it.

No matcher implementation, UI, search-run HTTP endpoints or workspace schema changes in this change. Document the future workflow/matcher handoff in the web README. Add an ADR (0007) and root vocabulary updates recording acquisition ownership and its separation from evaluation.

## Implementation sequence

1. Define portable schemas, source references, optional advertised facts, source-page/batch/detail results and typed errors. Remove provisional AI readiness and duplicated LinkedIn-only public options.
2. Adapt LinkedIn to typed objects and source-neutral discovery input, including work-arrangement spelling and absolute age cutoff translation. Add signal-based cancellation/deadline, bounded retries, safe reference resolution, actual-content validation, unknown availability and fixture-backed page/overflow behavior. Return objects instead of JSON strings; remove redundant catch-and-rethrow blocks.
3. Add the registry and run facade using injected adapters. Implement fair bounded paging, exact deduplication, busy rejection, per-source failure isolation and explicit disposal. Keep matching and persistence out of this module. Facade tests use small in-memory fake adapters whose IDs, page sizes and continuation differ.
4. (Issue 02.) Prove the seam with JustJoin as the second production adapter. First research its public JSON endpoints used by its website (stability, terms, pagination, IDs); if they are unusable, stop and record the finding instead of scraping around it. Fixtures cover multiple locations, unknown salary and several compensation entries per vacancy.
5. Document interfaces, source-addition instructions, ownership and limitations; run focused tests, the full web suite, typecheck, lint and production build. No paid Jev calls or bulk source scraping is needed. An optional small live LinkedIn smoke check may verify acquisition but is not a deterministic correctness test and must report upstream access failures honestly.

## Required checks

- Contract validation rejects malformed inputs/results, unsafe URLs, unknown source IDs, invalid limits and malformed adapter cursors before network activity.
- LinkedIn mapping translates discovery inputs without leaking native options. Unsupported/approximate filters are visible; multi-arrangement queries cannot silently narrow results.
- Search/detail return actual typed objects. Fixtures cover valid, malformed, empty, blocked/login and closed pages; unknown status is preserved. Description formatting survives paragraph/list extraction. Missing required vacancy structure becomes `invalid-response`.
- Source-page sizes differ from requested limits; continuation returns overflow without skipping it. Combined limits of one and limits below source count still give every source turns. Repeated IDs deduplicate, while identical IDs from different sources remain distinct.
- Changing adapter completion order does not change merge order/fairness. Concurrent advancement is refused. Work per combined call is bounded even when pages are empty or contain only duplicates; non-progress cursors terminate explicitly.
- One failing source preserves healthy results, reports a failure and is not called on subsequent pages of that run. All sources failing remains distinguishable from successful exhaustion. A single failed detail leaves other references usable.
- Cancellation before a request, during response reading and during retry delay stops further work. Deadline exhaustion does not overrun through retries or `Retry-After`; disposal aborts and releases run state.
- Native compensation, several entries per vacancy (B2B and permanent), multiple locations and unknown facts survive normalization. Derived display pay is not mislabeled as employer evidence. Dates/expiry/observation time remain distinct.
- Registering JustJoin requires only its adapter, one enum value and one registry entry; no edits to app orchestration or facade branches. Shared code imports no feature modules; client code cannot import source execution. Run existing web checks without unrelated changes.

## Source research and limits

- [NoFluffJobs public search](https://nofluffjobs.com/remote?criteria=keyword%3Dapi&page=1) demonstrates website pagination and public listings; it does not establish a supported stable API contract.
- [NoFluffJobs detail example](https://nofluffjobs.com/job/data-integration-etl-developer-astek-polska-gdynia) exposes multiple locations, advertised requirements, expiry and native hourly pay alongside displayed monthly equivalents.
- [NoFluffJobs homepage](https://nofluffjobs.com/) and [listing examples](https://nofluffjobs.com/API/random) informed optional salary and native period handling. These are changing website observations, not adapter guarantees.
- [OpenRouter Jev documentation](https://openrouter.ai/docs/guides/community/jev) supports typed decisions/probabilities rather than generated explanations. Jev remains a future matcher integration, separate from the `shared/ai` providers (Codex, Claude) used for CV interpretation, and needs its own OpenRouter credential. No representative matching accuracy, end-to-end latency or cost has been measured for this app.

No official supported NoFluffJobs public read/search API, authentication contract, quotas, stable native ID or page/exhaustion guarantee was verified. Those require adapter-specific research when that source is implemented. No such uncertainty should leak as source-specific branching in callers.

## Ponytail ultra assessment

One registry, two acquisition operations, a run-scoped facade and typed facts are sufficient. Skip plugin discovery, remote deployments, persisted run infrastructure, AI/cache-readiness abstractions, generic scraping frameworks, cross-source fuzzy merging and Jev integration. Continuation lives in the run object, so there is no facade cursor protocol and no server-global session store.

All interview decisions Q1–Q19 are incorporated; Q4 was refined by Q8/Q9 and the agreed facade/matcher split. The plan was reviewed and approved for implementation. Issue 01 covers steps 1–3 and 5; issue 02 covers step 4 and is blocked by 01.

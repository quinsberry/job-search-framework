# Job Search Framework web app

Local Bun/Next.js app for a job seeker: candidate profile, search preferences and vacancy acquisition. Decisions live in `../docs/adr/` (0005–0008); vocabulary in `../CONTEXT.md`.

## Run and check

```bash
bun run dev            # also: bun run build, bun run start
bun test               # deterministic; fictional workspaces, mocked AI, no live scraping
bunx tsc --noEmit
bun run lint
```

AI conversion needs an installed Codex CLI with a ChatGPT login (`codex login`). Profile/preference editing works without it. The folder picker uses `osascript` on macOS, PowerShell on Windows and requires `zenity` on Linux.

Keep the Bun server running during conversion: server termination interrupts unfinished jobs, which then need explicit Retry. No hosted/serverless execution.

## Workspace storage

The app writes only its own namespaces in the selected workspace:

```text
candidate-profile/   profile.yaml, draft.yaml, sources/<sha256>.*, conversions/<sha256>/
search-preferences/  config.yaml, draft.yaml
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

**Adding an AI provider** (e.g. Claude): adapter in `shared/ai/server/`, its ID in `shared/ai/contracts.ts`, registry entry and Agent metadata. Profile forms, recovery and persistence don't change.

## Vacancy acquisition

Server-only entry points: `listSearchSources` and `SearchRun` in `shared/search-sources/server/search.service.ts`. Construct a run with `new SearchRun({ sourceIds, query }, signal, optionalAdapters)`. A run keeps all continuation in memory: call `next(limit)` until `done`, inspect `batch.sources` for failures, and always `dispose()`. There is no persistence, restart resume, cache or cross-source identity inference. Acquisition never judges fit; filters are reported as applied, approximate or unsupported.

**Adding a source**: implement `SearchSourceAdapter` under `server/<source>/`, add its ID to `sourceIdSchema` and its adapter to the private registry in `server/search.service.ts` (checked for enum coverage). Validate cursors and external payloads, preserve overflow and source-owned IDs, never fetch arbitrary reference URLs, and add fixtures for parsing, access failures, pagination and cancellation. Adapters import only the portable contracts.

LinkedIn uses public guest HTML endpoints; upstream HTML changes can require parser updates.

## Matching

`modules/search/server/matching/match.ts` exports `matchJob(detail, { preferences, skills }, { model }, signal)`. It runs structured checks first, then one decision request for unresolved criteria, and returns strict `match`, `no-match` or `needs-clarification` results with criterion evidence and reported cost. Evaluation/transport failures reject with `MatchError`; they never become rejection decisions. Salary is compared only from structured advertised pay in matching contract, currency and period units, never inferred from description text or converted between units.

The optional **Minimum skill match (%)** field accepts 1–100; empty skips the skills criterion. Older configs and recovery drafts remain valid. Required skill names compare after lowercasing/removing non-alphanumerics; no alias table is supplied. Structured lists currently count as must-have. With a threshold but no candidate skills, matching rejects with “Add skills to your profile or clear the skill match threshold”. The future workflow must check that before starting acquisition.

Production callers supply `new DecisionModelClient()` from `decision-model.ts`. It currently calls Jev (`typesafe/jev-1.14`) through `@typesafe-ai/sdk`, using the OpenRouter base URL and server-side `OPENROUTER_API_KEY`. The SDK owns HTTP, JSON decoding and retries; a fetch guard preserves the response-size limit and rejects Retry-After waits above two seconds. Responses still pass runtime Zod validation. Compression and SDK logging are disabled to keep the wire budget explicit and vacancy content out of logs. The [OpenRouter System One documentation](https://openrouter.ai/docs/guides/community/typesafe-sdk) defines its HTTP envelope; [TypeSafe's API reference](https://docs.typesafe.ai/api) defines typed answers. The model client maps an expected score over five coverage levels to 0–100. To replace the decision model, change only the implementation and input budget in `decision-model.ts`; callers and matching rules use neutral questions and answers.

All questions for a job share one context. The client allows 28,000 UTF-8 bytes for the neutral request, reserving space below the 32,000-byte wire budget. Oversized criteria reject before calling the model; descriptions are truncated to fit, making all model-derived criteria unknown. Probability bands are fixed at 0.2/0.8; model skill coverage uses a ±10-point band around the threshold. These rules have deterministic fake-model tests, but real matching accuracy and threshold calibration have not been measured. HTTP retries stop after three attempts, cap Retry-After waits at two seconds, bound response bodies and obey cancellation/deadlines.

This adds no search loop, result persistence, matching endpoint or results UI. Tests use fake decision models and mocked HTTP; no live model calls are needed.

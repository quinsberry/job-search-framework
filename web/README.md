# Job Search Framework web app

Local Bun/Next.js app for a job seeker: candidate profile, search preferences and vacancy acquisition. Decisions live in `../docs/adr/` (0005–0007); vocabulary in `../CONTEXT.md`.

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

Server-only entry points: `listSearchSources` and `createSearchSourceRun` in `shared/search-sources/server/search.service.ts`. A run keeps all continuation in memory: call `next(limit)` until `done`, inspect `batch.sources` for failures, and always `dispose()`. There is no persistence, restart resume, cache or cross-source identity inference. Acquisition never judges fit; filters are reported as applied, approximate or unsupported.

**Adding a source**: implement `SearchSourceAdapter` under `server/<source>/`, add its ID to `sourceIdSchema` and its adapter to the private registry in `server/search.service.ts` (checked for enum coverage). Validate cursors and external payloads, preserve overflow and source-owned IDs, never fetch arbitrary reference URLs, and add fixtures for parsing, access failures, pagination and cancellation. Adapters import only the portable contracts.

LinkedIn uses public guest HTML endpoints; upstream HTML changes can require parser updates.

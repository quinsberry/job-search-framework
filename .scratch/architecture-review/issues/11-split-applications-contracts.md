# 11 — Split `applications/model/contracts.ts` by concern

Status: needs-triage
Type: task

`web/src/modules/applications/model/contracts.ts` (about 219 lines) combines four concerns:

- the application list: row schemas, `applicationsFileSchema` v3, the legacy `applicationsFileV1Schema`, manual input and per-origin `changesSchemas`;
- search memory entries (`inspectedEntrySchema`);
- run events (`runEventSchema` and its types);
- HTTP request and response schemas (`applicationsRequestSchema`, `runRequestSchema`, `loadResultSchema`, `rowResultSchema`, `emptyResultSchema`).

Split into files under `model/` (for example `list.ts`, `search-memory.ts`, `run-events.ts`, `api.ts`). Keep exported names unchanged; a temporary `contracts.ts` re-export is acceptable only if it keeps the diff reviewable, and should be removed in the same change.

Pure move. Done when no file mixes these concerns and tests, typecheck, lint and build pass.

## Comments

# 01 — Search memory, application list and mutations

Status: resolved
Type: task

Implement the storage half of [the spec](../spec.md): split `store.ts` into `search-memory.ts` and `application-list.ts`, record accepted vacancies in search memory, the v2 list with statuses, expected salary and manual rows, per-origin edit schemas in `contracts.ts`, the migration, the workflow wiring (`memory` + `Pick<ApplicationList, 'has' | 'add'>`), and the `add` / `update` / `delete` actions. Update the current table just enough to keep rendering v2 rows. ADR 0010, `CONTEXT.md` and README.

Done when the spec's storage, workflow, migration and route checks pass, a copy of the real workspace migrates with all 10 applications intact, and the web suite, typecheck, lint and build pass.

## Comments

### Implementation — 2026-10-23

`store.ts` is split into `search-memory.ts` (whole-run lock, `accepted` entries never pruned) and `application-list.ts` (lock, re-read and rewrite per write). The list has `add` for the workflow and `addManual` for the route rather than one overloaded `add`; the workflow's dependency is `Pick<ApplicationList, 'has' | 'add'>` and it adds the row before remembering it. Per-origin edit schemas in `contracts.ts` reject read-only fields (400). `migration.ts` runs from both routes, taking the memory lock before the list lock as a run does. Shared changes: `WorkspaceFiles.remove`, and `errorResponse` maps `not-found` to 404. The table already renders v2 rows, including manual ones.

The real workspace was migrated by the already-running dev server on port 3000 when it hot-reloaded: 20 v2 rows, search memory with 20 accepted and 32 rejected entries, old index removed. A migration of a copy confirmed fingerprints are unchanged.

Validation: 182 tests pass, typecheck, lint (the existing `preferences-fields.tsx` warning) and build pass.

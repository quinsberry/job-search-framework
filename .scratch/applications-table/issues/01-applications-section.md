# 01 — Applications section, run controls and table

Status: resolved
Type: task

Implement [the spec](../spec.md): `ApplicationsSection` in `WorkspaceContent`, `ui/search-run.tsx`, the table columns over a pure `rows.ts` view model, the expanded criteria row, `sources` on the load result, the `no-new` run reason, `useSearchRun` budgets and client-side `cancelled`, the `applicaitons-table` → `applications-table` rename, and the README and ADR 0009 updates. The demo table leaves `page.tsx`.

Done when the spec's required checks pass and the web suite, typecheck, lint and build pass. No live source requests or model calls.

## Comments

### Implementation — 2026-10-23

Implemented `ApplicationsSection` (in `WorkspaceContent`, keyed by session), `ui/search-run.tsx`, the table over the pure `rows.ts` view model, the expanded criteria list, `sources` on the load result, the `no-new` run reason, and the `applicaitons-table` rename. `useSearchRun` now exposes budgets and job/source failure counts, ends in `cancelled` on a client cancel, and treats a stream that closes without `done` as failed. Filtering happens in `rows.ts` before the table, so the column-filter feature and the selection column are gone; rows keep their fingerprint id so expansion and paging survive live refreshes.

The section test mocks the view-options menu, pagination and sortable headers: Base UI menus need a DOM document that react-test-renderer does not provide. Checked in the browser against the real workspace (10 applications); no search run was started.

Validation: 171 tests pass, typecheck, lint (the existing `preferences-fields.tsx` warning) and build pass.

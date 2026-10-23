# 02 — Status, expected salary, add/edit/delete UI

Status: resolved
Type: task
Blocked by: 01

Implement the UI half of [the spec](../spec.md): Status column with inline select, Expected salary column, ⋯ row menu, the shared add/edit dialog, delete confirmation, toasts, status filter (Active by default), Source and Published hidden by default, manual-row presentation in `rows.ts`.

Done when the spec's UI checks pass, the flows are checked in the browser against the real workspace, and the web suite, typecheck, lint and build pass.

## Plan (grilled 2026-10-23)

- **Server**: `deleted: string[]` on the list file; `remove` records the fingerprint, `has` counts it, `addManual` clears it. Same for every origin; works during runs.
- **Layout**: `client/api.ts` + `addApplication`/`updateApplication`/`deleteApplication`; `client/queries.ts` + `useApplicationMutations(workspace)` (refetch the list after each); `rows.ts` + `filterRows(rows, text, status)`, status labels, the Active set; `applicationColumns(actions)` factory with `{ onStatus, onEdit, onDelete }`; `status-select.tsx`, `row-actions.tsx`, `application-dialog.tsx`, `delete-dialog.tsx`; the section owns `editing: row | 'new' | null` and `deleting: row | null`; `ToastProvider` in `app/providers.tsx`.
- **Form**: react-hook-form + zodResolver with the shared `TextField`; add uses `manualInputSchema`, edit the row's `changesSchemas` entry; sends every editable field; field errors inline, server errors above the buttons.
- **Status select**: not optimistic; disabled while saving; silent on success; error toast and the stored value on failure.
- **Toasts**: added, saved (dialog), deleted, failed status change.
- **Delete dialog**: "Delete application?" / "“Title” at Company will be removed. Searches won't find it again." / Cancel, Delete (destructive).
- **Gone rows**: 404 closes the dialog with a toast "This application no longer exists" and refetches; 409 keeps the dialog open with the message.
- **Tests**: `rows.ts` units, `useApplicationMutations` with mocked fetch, list `deleted` behaviour, section test with Base UI parts stubbed; dialogs and select checked by hand in the browser. No new dependencies.

## Comments

### Implementation — 2026-10-23

Built as planned: `deleted` fingerprints on the list file (any origin; `has` counts them; adding by hand clears one), `useApplicationMutations`, the `applicationColumns(actions)` factory with Status, Expected salary and the ⋯ menu, `status-select.tsx` (inline select and the status filter), `row-actions.tsx`, `application-dialog.tsx`, `delete-dialog.tsx`, and the section owning dialog state, mutations and toasts. Source and Published are hidden by default; manual rows show "—" for arrangement.

Found while checking in the browser: the shared `httpUrlSchema` refine ran `new URL()` on input that had already failed the URL check, so an empty link crashed validation instead of reporting it (fixed with `URL.canParse`, regression test added); required-field messages were raw Zod text (now "Paste the link to the posting", "Enter the job title"); a second `Toaster` duplicated every toast (layout already mounts one).

Checked by hand on a copy of the workspace: inline status change, edit of a search row (status and expected salary only), add with validation, duplicate refused with the dialog kept open, delete with confirmation recorded in `deleted`. Open: the table is 1493px wide against 1246px available at a 1280px window.

Validation: 187 tests pass, typecheck, lint (the existing `preferences-fields.tsx` warning) and build pass.

### Review follow-up — 2026-10-23

Applied both ponytail review findings: moved search-run status text and its tests into `ui/run-status.ts`, moved form defaults and their tests into `application-table/application-form.ts`, and replaced the two select implementations with one `OptionSelect` used by the row, dialog and filter. `rows.ts` now holds table display and filtering rules only; the search UI no longer imports it.

Reverified after resuming the interrupted session: 187 tests pass, typecheck and production build pass, lint has only the existing unused `disabled` warning in `preferences-fields.tsx`, and `git diff --check` passes. Browser check on `/private/tmp/ws-ui`: Applied filters to the single Applied row; restored Active afterwards. The table-width decision remains open.

# 13 — Move generic and shared helpers out of `application-table/rows.ts`

Status: wontfix
Type: task

`web/src/modules/applications/ui/application-table/rows.ts` is the table view model (row projection, sorting, filtering), but it also exports `relativeDate(iso, now)`, a generic date formatter, and `statusLabels` / `statusFilterLabels`, the application status vocabulary.

The original proposal was to move `relativeDate` to `shared/lib/` and the labels to an applications UI labels file.

## Comments

### Verification — 2026-10-23

All three are used only inside `ui/application-table/` (`rows.ts`, `status-select.tsx`, `applications-columns.tsx`). Moving them now would be speculative. Reopen when a second consumer outside the table needs them: move `relativeDate` to `shared/lib/` once another module formats dates, and the status labels once another applications UI uses them.

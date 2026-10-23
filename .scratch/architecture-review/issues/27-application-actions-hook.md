# 27 — Extract row actions and feedback from `LoadedApplications`

Status: needs-triage
Type: task

`LoadedApplications` in `modules/applications/applications-section.tsx` (about 120 lines) wires three mutations, two dialogs' state, form error handling and toast feedback, and repeats the "row no longer exists" mapping (`gone(failure) ? goneToast() : toast.add(…)`) in status change, submit and delete.

Extract a `useApplicationActions(workspace)` hook in `modules/applications/client/` (or `ui/`) that owns the mutations, dialog targets, form error and a single error-to-feedback mapping, and returns the handlers and busy flags the section and dialogs need. The section then only lays out the card, run controls, table and dialogs.

Low priority: do it when the section next grows (for example new row actions). No behaviour change; `applications-section.test.tsx` must pass unchanged.

## Comments

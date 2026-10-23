# 33 — Accessibility audit of the main flows

Status: needs-triage
Type: task

The UI uses Base UI primitives and labels its custom controls: the search status line is a polite live region, the row expander has `aria-expanded` and a label, row menus are labelled per title, and selects carry labels and `aria-invalid`. No end-to-end accessibility check has been done, though, and there are no browser tests.

Audit, with keyboard only and a screen reader (VoiceOver on macOS):

- opening a workspace, connecting an agent, uploading a CV and following conversion progress;
- editing, publishing, discarding and resolving a draft conflict in both editors, including whether recovery status changes are announced;
- running and cancelling a search; filtering, sorting, paging and expanding the table; editing, resolving and deleting a row through dialogs (focus moves into a dialog and returns afterwards);
- toasts: announced, not the only place an error is reported, and not dismissed before they can be read;
- colour contrast of muted text (for example the muted unadvertised salary) and status badges.

Record findings as comments here and file a task per fix. If a repeatable automated check is wanted, propose one (for example axe run against the dev server) as a separate issue rather than adding a browser test stack here.

## Comments

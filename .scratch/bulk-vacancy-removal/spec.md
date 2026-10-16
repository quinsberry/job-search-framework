# Bulk vacancy removal and visible feedback

Status: resolved

## Request

The Remove vacancy action appears to do nothing or lacks visible feedback. Add vacancy selection and bulk actions, initially removal only.

## Existing agreed semantics

Removal forgets vacancy/search history, permits later rediscovery and preserves independently owned application records. Removal is unavailable during a running search to prevent immediate resurrection by its accumulated snapshot. Existing row revisions protect against stale writes.

## Design frontier

- Selection scope when table filters/search/workspace change.
- Atomic batch behavior if a selected row is stale or unavailable.
- Shared single/bulk confirmation and visible pending/success/failure feedback.

Read-only investigation of the reported bug is running in an isolated fictional workspace. The user agreed to all frontier proposals; the implementation follows those decisions.

## Agreed decisions

Q1: Row selection checkboxes, Select all visible, and N selected / Remove selected toolbar. Clear selection when filter, text search or workspace changes. Selection is unrelated to application submission.

Q2: Atomic batch removal; any stale/missing selected row stops the entire operation without writes. Explain affected rows and retain selection for retry.

Q3: Shared in-app confirmation for single/bulk removal, listing selected vacancies. Show Removing…, prevent duplicate submission, then a persistent table-level Removed N vacancies message after success. Keep rows and a nearby error on failure.

The user agreed to all three proposals, settling the full frontier and authorizing implementation. Read-only fixture checks confirmed actual deletion succeeds, but cancellation through native confirm is silent and loading/success feedback is absent; the user's exact no-delete cause remains unconfirmed.

## Implementation and verification

The owner implements pure remove_many and persisted delete_many, with single removal delegating to the same operation. Workflow validates composed revisions (including applications) under its lock before one owner save. Standalone remove-many and the protected bulk HTTP endpoint are available.

The table has individual/header selection, visible-row selection only, and clearing on filter/text/workspace changes. Single and bulk removal share an in-app dialog with explicit cancel, pending, error and success states. Failed requests keep rows/selection. Refresh selection reloads revisions for review and prevents submission while refreshing. Table-level status remains near the action.

Verified 167 automated tests plus application CSV checks, owner/workflow skill validators, JS syntax and diff checks. Independent fictional-workspace CLI testing proved stale-member all-or-nothing behavior, one save on successful removal, unchanged application bytes and rediscovery/relinking. Browser flows verified select-all/filter clearing, cancellation, delayed-request pending state, simulated error with retained selection, refresh/retry, two-row removal, single removal and reload persistence. Some T3 pointer calls stopped dispatching events late in the check, so the final single-row flow used DOM click events through the same preview; no external browser was used. No real candidate data or live searches were changed.

# 23 — One policy for detecting external edits in both editors

Status: needs-triage
Type: task

Both editors detect edits made on disk or in another tab by refetching their snapshot and calling `session.observe`, but they trigger refetches differently:

- Preferences: `refetchOnWindowFocus: 'always'` in `preferencesOptions`, plus a manual `window` `focus` listener in `use-preferences-session.ts` that refetches active queries.
- Profile: React Query's default focus behaviour only (no `'always'`, no window listener).

React Query's focus manager reacts to `visibilitychange`, so the manual listener additionally catches switching back from another application window; preferences gets both, profile only one. A conflict can therefore surface later for the profile than for preferences.

Decide one policy and apply it to both, ideally inside the shared hook from issue 22. Document in a code comment why the window `focus` listener is needed in addition to React Query's focus handling, or remove it if it is not. Profile's `refetchInterval` during conversion stays as is.

Done when both editors use the same trigger set, with a test per editor that a refetch on focus with a changed revision reports a conflict.

Blocked by: 22

## Comments

# 22 — Extract the shared draft editor hook and snapshot commit helper

Status: needs-triage
Type: task

`modules/profile/client/use-profile-session.ts` and `modules/search/client/use-preferences-session.ts` repeat the same orchestration around `createDraftSession`:

- create the session once with `useState`;
- one effect that calls `activate`, registers `onSession`, subscribes to react-hook-form value changes, adds a `beforeunload` guard while edits are pending, and disposes on cleanup;
- a `resetting` ref so programmatic `reset` is not treated as an edit;
- a mutation wrapping `session.command`, applying `result.replacement` and raising success/error toasts.

`commitProfile` (`profile/client/queries.ts`) and `commitPreferences` (`search/client/queries.ts`) are identical apart from the query key, and `useSyncExternalStore(session.subscribe, session.getState, session.getState)` is repeated in `preferences-editor.tsx`, `profile-editor.tsx` and `profile-form.tsx`.

Proposal, in `shared/drafts/`:

- `commitSnapshot(client, queryKey, operation)`: cancel reads, run the write, cancel again, set query data, return the snapshot.
- `useDraftEditor({ session, form, toDraft, fromDraft, onSession })`: session lifecycle, form subscription with the reset guard, the unload guard, a `replace(draft)` helper and a `useRecoveryState(session)` wrapper around `useSyncExternalStore`.
- Feature hooks keep only their command set, labels and feature-specific steps (profile conversion-job reconcile, `onPublished`). Success/error messages are passed in rather than hard-coded in the shared hook, so the hook does not decide UI copy.

No behaviour change. The existing tests in `shared/drafts/recovery-session.test.ts`, `use-profile-session.test.tsx` and `use-preferences-session.test.tsx` must pass unchanged; add direct tests for `useDraftEditor`. Done when the duplicated blocks are gone and tests, typecheck and lint pass.

## Comments

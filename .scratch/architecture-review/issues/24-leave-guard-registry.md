# 24 — Replace per-editor callback refs with a leave-guard registry

Status: needs-triage
Type: task

Before switching workspaces, `app/workspace-content.tsx` flushes unsaved drafts. Each editor hands up a `SessionHandle` through an `onSession` prop; `WorkspaceContent` keeps one ref per editor (`profile`, `preferences`), one `attach` callback per editor, and flushes and disposes each by name. Adding a third editor means touching `WorkspaceContent` in three places and threading `onSession` through the section and editor props.

Proposal: a small context in `shared/drafts/` (for example `LeaveGuardProvider` with `useLeaveGuard(handle)`), where editors register their handle on mount and unregister on unmount. `WorkspaceContent` calls `guards.prepareToLeave()` and `guards.dispose()` without knowing which editors exist. The `beforeunload` guard can move into the same registry, so it is registered once rather than per editor.

Keep the current ordering guarantees: all editors flush before the new workspace is validated; editors are disposed only after both storage contracts load. Done when `onSession` props are gone, the existing `workspace-content.test.tsx` behaviour holds, and tests, typecheck and lint pass.

Blocked by: 22

## Comments

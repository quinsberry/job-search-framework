# 30 — Evaluate enabling the React Compiler

Status: needs-triage
Type: research

The app is on React 19 and Next.js 16 and memoises by hand: `useMemo`/`useCallback` appear in nine source files, partly to keep callbacks stable for effect dependencies (`attach`, `attachPreferences`, `preferencesPublished` in `workspace-content.tsx`; the row actions in `applications-section.tsx`). The React Compiler can make most of this unnecessary.

Find out, using `node_modules/next/dist/docs/` for this Next.js version: how to enable it with Turbopack and Bun, whether `eslint-plugin-react-hooks`' compiler rules flag any existing code, and whether the draft engine integration (`useSyncExternalStore`, the `resetting` ref pattern, react-hook-form `subscribe`) behaves identically under it. Record the answer as a comment here: enable (with a follow-up task to remove redundant memoisation), or not yet, with the reason.

Do not remove manual memoisation that effect dependencies rely on without the compiler enabled.

## Comments

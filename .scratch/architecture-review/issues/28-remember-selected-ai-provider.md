# 28 — Remember the selected AI provider

Status: needs-triage
Type: task

The open workspace is remembered in `localStorage` (`workspace-session.tsx`, key `candidate-profile.workspace.v1`) and restored on load, but the AI provider chosen in the Agent section resets to `DEFAULT_PROVIDER` (`codex`) on every page load (`modules/agent/agent-session.tsx`). A user who works with Claude has to reselect it each time.

Persist the selection the same way: a versioned `localStorage` key, read once on mount, validated with `providerSchema` (an unknown or removed provider falls back to the default), with storage failures ignored as in `workspace-session.tsx`. Avoid a hydration mismatch: read it in an effect, not during render.

Done when a reload keeps the chosen provider, an invalid stored value falls back to the default, and tests, typecheck and lint pass.

## Comments

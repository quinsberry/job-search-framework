# 05 — Use one Zod import path

Status: needs-triage
Type: task

The code imports Zod both as `zod` and as `zod/v4` (for example `web/src/shared/http/client.ts` uses `zod/v4`, `web/src/shared/http/server.ts` uses `zod`). With Zod 4 both resolve to the same API, so this is inconsistency only.

Pick one path, update all imports and add an ESLint `no-restricted-imports` rule for the other. Done when typecheck, lint and tests pass.

## Comments

# 08 — Read server configuration through one validated module

Status: needs-triage
Type: task

`OPENROUTER_API_KEY` is read and trimmed separately in `app/api/applications/run/route.ts` (availability check) and `modules/search/server/matching/decision-model.ts` (client construction). The two checks can drift, and there is no single list of the settings the server uses.

Add a small server-only config module in `shared/` that reads and validates environment settings with Zod, exposing for example `openRouterApiKey(): string | undefined`. Use it from both call sites. Leave the CLI providers' environment pass-through in `shared/ai/server/claude.ts` and `codex.ts` alone; that forwards the user's environment to child processes and is not configuration.

Keep this minimal: one module, no config framework. Document the settings in `web/README.md` and `.env.example`. Done when no direct `process.env.OPENROUTER_API_KEY` read remains and tests, typecheck and lint pass.

## Comments

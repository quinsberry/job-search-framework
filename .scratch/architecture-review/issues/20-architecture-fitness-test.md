# 20 — Architecture fitness test over the import graph

Status: needs-triage
Type: task

Some architecture rules are about the import graph as a whole, which per-import ESLint rules cannot express. Add `web/src/architecture.test.ts`, run by `bun test`, that builds the graph with `new Bun.Transpiler({ loader: 'tsx' }).scanImports()` over `src/**` (no new dependency) and asserts:

- no import cycles;
- `modules/applications` has no imports, type-only included, from the preferences module (locks in issue 09);
- each feature's `model/` imports only `zod`, `shared/lib` and domain contracts, so it stays pure and portable;
- route files import at most N module files (pick N from the post-issue-06 baseline), so routes stay thin.

Failure messages name the offending file and import and point to `docs/agents/architecture.md` (issue 21). Resolve `@/` aliases and relative paths the same way TypeScript does; ignore package imports except where a rule names them.

Land after issues 03, 06 and 09 so the baseline is the target architecture. Done when the test passes on `main` and fails for a deliberately introduced cycle and a forbidden import.

Blocked by: 03, 06, 09

## Comments

# 16 — Run typecheck, lint, tests and build automatically

Status: needs-triage
Type: task

The repository (GitHub, `quinsberry/job-search-framework`) has no CI workflow and no git hooks. The ESLint boundary rules, their tests in `web/eslint.config.test.ts` and every check proposed in issues 17–21 only help if they run without someone remembering to.

Add a GitHub Actions workflow on push and pull request that, in `web/`, installs with Bun (`bun install --frozen-lockfile`) and runs `bunx tsc --noEmit`, `bun run lint`, `bun test` and `bun run build`. Optionally add a lefthook pre-push hook running the same commands locally; keep it fast enough that it is not routinely skipped.

The suite is already deterministic and offline (fictional workspaces, mocked AI, no live scraping), so it needs no secrets. The opt-in live checks from issues 01 and 04 must stay out of CI.

Done when the workflow passes on `main` and a deliberate boundary violation fails it.

## Comments

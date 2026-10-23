# 21 — Dead code check and an agent-facing architecture guide

Status: needs-triage
Type: task

Two small maintenance aids:

1. **knip** for unused files, exports and dependencies. The moves, splits and renames in issues 03, 10, 11 and 12 will leave stale exports behind. Add knip as a dev dependency with a config for Next.js and Bun tests, fix or explicitly ignore its initial findings, and add `bun run knip` to the checks in issue 16.
2. **`docs/agents/architecture.md`**, linked from the root `AGENTS.md` like the other agent docs: the layers (`app`, `modules`, `domain`, `shared`) and what each may import, where composition and adapter wiring happen, the extension checklists (source, AI provider, decision model) with their conformance suites, the stored-format and digest rules, and what to do when the ESLint rules or the fitness test fail. Keep it short and point to the README and ADRs rather than duplicating them.

Do not add dependency-cruiser, eslint-plugin-boundaries or madge; the ESLint rules (issue 17) and the fitness test (issue 20) cover them.

Done when knip runs clean in CI and the guide is linked from `AGENTS.md`.

Blocked by: 16

## Comments

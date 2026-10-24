# 17 — Extend ESLint rules to lock in the refactored architecture

Status: needs-triage
Type: task

`web/eslint.config.ts` already derives feature boundaries from the module directories, and `web/eslint.config.test.ts` tests them. Extend both as the related issues land, using built-in `no-restricted-*` rules only (no custom plugin):

**Layers** (after issue 03)

Issue 03 creates `src/domain/` (search sources, matching and vocabulary) and lands its own layer rules with it: `src/domain/**` never imports `src/modules/**` or `src/app/**`, `src/shared/**` never imports `src/domain/**`, and a domain part imports only other parts' contracts. AI providers stay in `shared/ai/`, so the `shared/ai/server/` exemption below keeps its path.

- `src/modules/**` must not import `src/app/**`.

**Restricted imports**
- `zod/v4` is an error; one Zod import path (issue 05).
- `@typesafe-ai/sdk` only in the decision-model adapter file (issue 10).
- Concrete adapters and registries (`DecisionModelClient`, `SearchRun`/the source registry, the AI `providers` registry) only from `src/app/api/**` and tests, so features depend on interfaces and the composition root wires implementations.

**Restricted syntax and properties**
- `process.env` outside the config module (issue 08), with an exemption for the CLI adapters in `shared/ai/server/` that forward the environment to child processes.
- `Object.assign(new Error(…), …)` (issue 07).

**Cohesion signal**
- `max-lines` as a warning at about 250 lines per non-test source file, excluding the generated UI kit.

Each rule gets allowed/forbidden cases in `eslint.config.test.ts`, matching the existing table style. Rules for a layer or file that does not exist yet land with the issue that creates it.

## Comments

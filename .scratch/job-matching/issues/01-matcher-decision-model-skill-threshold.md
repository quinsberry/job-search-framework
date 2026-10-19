# 01 — Matcher, decision model and skill match threshold

Status: resolved
Type: task

Implement [the spec](../spec.md): `modules/search/server/matching/` (`decision-model.ts` with the Jev implementation, `structured.ts`, `questions.ts`, `match.ts`), the optional `minSkillMatch` preference with its form field, ADR 0008, glossary terms and the README Matching section.

Done when the spec's required checks pass with a fake `DecisionModel`, and the web suite, typecheck, lint and build pass. No live model calls in tests.

## Comments

## Answer

Implemented the [matching design](../spec.md) in Search's `server/matching/`: pure structured checks, neutral questions and validated answers, a bounded decision-model client, and `matchJob` with typed operational errors. The current production wire mapping is isolated in `decision-model.ts`, verified against the OpenRouter System One and TypeSafe API documentation. Structured failures avoid model calls; explicit unknown choices remain unknown, and description truncation downgrades model-derived criteria to unknown. Native salary units, residence checks and must-have skill coverage follow the spec.

Added optional `settings.minSkillMatch`, its form control, draft/save mappings and persistence coverage. Old configs and recovery drafts without the field remain valid. ADR 0008, root vocabulary and the README Matching section record the decisions and limitations. Acquisition, profile ownership, search workflow, HTTP endpoints and results UI are unchanged.

Validation: `bun test` passes all 136 tests across 30 files; `bunx tsc --noEmit`, `bun run lint` and `bun run build` pass. Lint retains seven pre-existing unused-variable warnings. Tests use fake decision models and mocked HTTP, including retries, deadlines, cancellation, malformed responses and a >200 KB multibyte vacancy whose wire body stays under 32,000 bytes. Browser DOM checks confirmed that 101 shows a threshold error and 65 clears it in a fictional temporary workspace; screenshot capture was unavailable. No live model calls or spending occurred; real accuracy and threshold calibration remain unmeasured.

### SDK refactor

Production acquisition of decisions now uses the installed `@typesafe-ai/sdk` client and its question helpers with the OpenRouter base URL, pinned model and explicit credentials. The SDK owns HTTP, JSON decoding and the single bounded retry loop; the existing decision interface, neutral answer mapping, runtime validation, input budget and operational error codes remain intact. A guarded fetch preserves the response byte/encoding limit and stops instead of retrying when server-requested waits exceed two seconds. SDK compression and logging are disabled. Fixed relative imports following the move of matcher tests to `__tests__/`, and the source-fixture dependency symlink now points to `web/node_modules`.

Validation: 137 tests pass; typecheck, lint and production build pass with the same seven existing lint warnings. SDK-backed mocked HTTP tests cover short/long Retry-After handling, retry counts, cancellation through fetch/body/retry waits, malformed responses and the wire byte budget. No live model calls were made.

# 01 — Source contracts, LinkedIn adapter and run facade

Status: claimed
Type: task

Implement steps 1–3 and 5 of [the spec](../spec.md): portable contracts and `sourceIdSchema`, the LinkedIn adapter moved under `server/linkedin/`, the registry and the run-scoped facade (`next(limit)`), plus docs, ADR and vocabulary updates.

Done when the spec's required checks pass for LinkedIn and fake adapters, and the web suite, typecheck, lint and build pass.

## Comments

### Implementation — 2026-10-19

Implemented portable strict contracts, the exhaustive LinkedIn registry, the disposable run facade and the server-only LinkedIn adapter. The facade uses deterministic round-robin acquisition with concurrency one, private overflow, exact identity deduplication, typed failure isolation, busy rejection and cancellation. LinkedIn fixtures cover safe references, discovery translation, native overflow, malformed/access/empty/closed pages, description formatting, dates, retries and body limits. README, root vocabulary and ADR 0007 document ownership and the future matcher handoff. JustJoin remains issue 02.

Validation: all 20 acquisition tests pass. Typecheck, production build and lint pass (lint reports seven existing warnings in untouched files). The full web suite has 113 passing tests and one existing failure in `web/src/modules/search/model/schema.test.ts:69`: its salary fixture includes `basis`, which `salaryBandSchema` rejects as an unknown key. Both files are unchanged from HEAD; the failure also reproduces when that test file runs alone. No live source requests or AI calls were made.

Implementation is complete, but this issue remains claimed because its full-suite acceptance condition is blocked by that separate preferences fixture/schema mismatch. No preference contract or unrelated test was changed.

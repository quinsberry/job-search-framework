# 06 — Move search run preconditions out of the route and extract the NDJSON stream helper

Status: needs-triage
Type: task

`web/src/app/api/applications/run/route.ts` mixes HTTP parsing, domain preconditions (preferences saved, skill threshold requires profile skills), environment checks (`OPENROUTER_API_KEY`), search-memory lock handling and NDJSON stream plumbing. The preconditions are domain rules living in the transport layer, so they can only be tested through the route.

Proposal:

- Add a `prepareRun(workspace)` (or similar) in `modules/applications/server/` that loads preferences and skills, checks the preconditions and returns the inputs `runSearch` needs, or a coded error. Preferences and profile access stays injected so the applications module keeps no runtime imports of other features.
- Extract a generic helper in `shared/http/server.ts` that turns an async iterable of events into an NDJSON `Response`, with abort-on-cancel and a completion callback for releasing the lock.
- Leave the route as wiring only.

No behaviour change: the same errors (including the 409 for a run already in progress), the same event stream and the same cancellation semantics. Done when existing route tests pass unchanged, the preconditions have direct unit tests, and typecheck, lint and build pass.

## Comments

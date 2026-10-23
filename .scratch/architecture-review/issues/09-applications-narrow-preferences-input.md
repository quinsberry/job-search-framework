# 09 — Give the applications module its own narrow input instead of `SearchPreferences`

Status: needs-triage
Type: task

`modules/applications/server/workflow.ts`, `queries.ts` and `fingerprint.ts` import `SearchPreferences` (and `workflow.ts` imports `MatchResult`) from the search module. These imports are type-only and allowed by the lint boundaries, but any change to the shape of the preferences schema ripples into query building, fingerprinting and the criteria digest. It also makes `search` a hub that other features depend on.

Define in `modules/applications/model/` the narrow input the workflow actually uses (position titles, location and remote acceptance, budgets, the criteria-digest inputs) and the match result shape it stores. Convert from `SearchPreferences` and `MatchResult` in the composition root (`app/api/applications/run/route.ts`, or the `prepareRun` from issue 06).

Watch out: the criteria digest must stay byte-identical for unchanged preferences, otherwise existing rejections in search memory are pruned on the next run. Add a test that pins the digest for a fixture preference set before refactoring.

Optional, lower priority than 06–08. Done when `applications` has no imports from `@/modules/search`, the digest test passes and the suite, typecheck and lint pass.

Blocked by: 06

## Comments

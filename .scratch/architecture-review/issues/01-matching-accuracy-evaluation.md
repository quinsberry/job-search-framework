# 01 — Measure matching accuracy against labelled vacancies

Status: needs-triage
Type: task

`matchJob` (`web/src/modules/search/server/matching/match.ts`) has deterministic fake-model tests, but its real accuracy and threshold calibration have never been measured (README, Matching section). The fixed 0.2/0.8 probability bands and the ±10-point skill-coverage band are unvalidated.

Build a small labelled set of real vacancies (expected `match`, `no-match` or `needs-clarification`, with per-criterion expectations where possible) and an opt-in script that runs `matchJob` with the real `DecisionModelClient` and reports agreement, per-criterion confusion and cost. It must stay outside `bun test`, which stays deterministic and offline.

Done when the dataset and script exist, a baseline report is recorded, and any band or threshold changes based on it bump `MATCHING_RULES_VERSION`.

## Comments

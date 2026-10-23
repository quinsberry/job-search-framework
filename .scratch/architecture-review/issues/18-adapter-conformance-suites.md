# 18 — Shared conformance test suites for extension points

Status: needs-triage
Type: task

Adding a search source, AI provider or decision model is meant to be "implement the interface and register it". Today each implementation has its own ad hoc tests (for example `linkedin/provider.test.ts`), so nothing guarantees a new adapter honours the same contract.

Add one reusable suite per interface, called from each implementation's test file (`describeSourceConformance(adapter, fixtures)` and so on):

- **`SearchSourceAdapter`**: cancellation, overflow handling, cursor validation, source-owned IDs, failure reporting for access/blocked/closed/malformed pages, never fetching arbitrary reference URLs, and filter reports (applied, approximate, unsupported).
- **`AIProvider`**: readiness reporting, a non-empty cache identity that changes with CLI version, error mapping and cancellation.
- **`DecisionModel`**: a non-empty, stable `identity` (issue 14), `maxInputBytes`, cancellation and deadlines, rejection of malformed or incomplete answers, and `MatchError` codes. Run it against the real client with mocked HTTP.

All suites stay deterministic and offline. Update the README's "Adding a source" and "Adding an AI provider" steps to require calling the suite.

Done when LinkedIn, Codex, Claude and the decision model client all pass their suites.

## Comments

# Vacancy contracts

## Inputs and operations

Python 3, standard library only. The sibling `jsf-search/scripts/evaluate.py` supplies criteria validation, timestamp parsing and stable identities. Keep the two skills together.

- `import`: a `jsf-search` result with `schema_version: 1`, normalized `criteria`, and the complete `snapshot` (`schema_version: 1`, timezone-aware `observed_at`, and raw `vacancies`). Consume its uncapped `assessments`, including evidence and checks. Older results can supply `matches`, `needs_clarification` and `rejected`; raw records without an assessment are retained as `unassessed`, never given an invented fit verdict. Coverage is retained as supplied. Assessment aliases must reference the snapshot. Import trusts search's evidence validation and does not reassess fit.
- `list`: workspace and optional `--state`. Read-only; an empty workspace returns an empty list.
- `review`: workspace, one known ID or URL, explicit state, timezone-aware decision timestamp, and optional note. Reject an unknown ID or a decision older than an existing choice. An identical retry is idempotent; a different choice needs a different timestamp.

All commands emit versioned JSON on stdout. Validation/read/write failures emit an error on stderr and exit 2 without replacing the existing history. Input files are read-only. `import --dry-run` creates no files.

## Outputs and storage

`import` returns `{schema_version, replayed, history, report}` plus `scope_id` on a new import. `history` is the updated full JSON state. Exact replays return unchanged history and empty report categories, with no disk rewrite.

`report` contains:

- `new`, `unchanged`, `changed`: entries with `vacancy_id`, changed raw `fields`, and `review_state`. Fields are title, company, location, description, source seniority/employment labels and activity. Changes to requirements, pay or restrictions are detected through the description. Whitespace/case-only differences do not count. Newly learned fields count as changes.
- `closed`, `uncertain`, `unassessed`: vacancy IDs. Uncertain includes unavailable URLs, conflicting same-time raw fields and unresolved review conflicts.
- `assessment_changed`: IDs and before/after fit status/check signatures. Changes in criteria, time or conversion inputs can affect fit independently of posting content; full criteria and assessment evidence remain in history.
- `not_observed`: IDs previously observed in the same eligibility-filter scope but missing from its latest snapshot. Coverage in `history.scopes[scope_id]` explains search limits/errors. This category never changes availability.

`list` and `review` return `{schema_version, vacancies}`. Each view includes ID, aliases, first/last observation times, last known raw fields with their observation times, availability, field conflicts, review choice/conflicts, and latest criteria-backed assessment. Missing incoming fields preserve older known values. Same-time contradictory fields remain unknown in the view and are retained in raw history.

The sole persisted file is `<workspace>/vacancies/history.json`: schema version, vacancies keyed by ID, old-ID redirects, search scopes and imported-input hashes. Each vacancy retains unique posting observations and criteria-backed assessments with first/last observation timestamps. Repeated payloads extend their observation span. Older inputs enrich history without replacing newer facts. Writes replace this file atomically. Use one writer per workspace.

## Identity, scope and availability

Reuse search identity: source ID/canonical posting URL, shared application URL, or employer plus requisition ID. Never merge by company/title resemblance. Proven identity bridges merge saved records, preserve observations and redirect previous IDs. Conflicting explicit review choices are retained for the user to resolve through `review`; posting changes never reset a choice.

Absence comparisons use normalized mandatory search filters. Source/title/location/eligibility/compensation/technical exclusions remain part of scope. Target count, discovery budget, ranking preferences and conversion inputs do not. Equal-timestamp checkpoints accumulate seen IDs; older snapshots do not rewind latest scope presence. Limited or failed coverage cannot establish closure.

Availability values are `open` (explicit active flag), `closed` (explicit inactive flag), `available` (accessible description with unconfirmed activity), `unavailable` (HTTP 404), or `uncertain` (fetch failure/conflicting observations). A legacy 404 with `active: false` is still unavailable, not closed. The LinkedIn adapter now retains closure-banner evidence and does not treat HTTP 404 as closure. A newer accessible page alone does not prove reopening of a previously closed vacancy.

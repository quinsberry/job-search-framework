# Vacancy contracts

## Python owner interface

Import `from jsf_vacancies import vacancies` after adding this skill's `scripts` directory to the Python path. The owner resolves its declared sibling `jsf-search`; no workflow initialization is needed. Original CLI commands remain at `scripts/vacancies.py`.

- `query(workspace)` is read-only and returns `{schema_version: 1, vacancies: [...]}`. Each entry contains `vacancy_id`, display `values`, identity `aliases`, redirected `previous_ids`, opaque `revision`, `fit`, `manual`, `checks`, `review`, `availability`, `original` source facts, and `corrected_fields`. Values combine known source facts with explicit corrections; consumers must not reconstruct them from history containers. An absent history returns an empty list.
- `known_identities(workspace)` is read-only and returns `{schema_version: 1, identities: [...], rediscovery_identities: [...]}`. Active identities include canonical display URLs for duplicate/exclusion checks. Rediscovery identities allow explicitly removed vacancies past application-only exclusions; active history identities still take precedence. They do not suppress results.
- `edit(workspace, identifier, field, value, at)` persists a review choice or display correction through the owner. Use an explicit timezone-aware timestamp. Unknown IDs, invalid values, older decisions, and corrections colliding with another displayed URL are rejected. It returns no payload; query again for current values/revision.
- `create(workspace, values, at)` returns `{schema_version: 1, vacancy_id, created}`. Requires nonempty company/title/HTTP(S) URL; optional fields use the correction contract. A duplicate canonical URL selects the existing vacancy with `created: false` and no write. New manual entries have `manual: true`, unknown activity and no fit assessment.
- `delete_many(workspace, selections)` validates a nonempty JSON list of `{vacancy_id, revision}` pairs and removes all selected vacancies with one atomic history save. Duplicate, missing, malformed or stale selections fail before publication. Pure `remove_many(history, selections)` returns proposed history without writes. It preserves the same application/rediscovery semantics as single removal.
- `delete(workspace, identifier, expected_revision)` removes the vacancy after checking its current owner revision. It prunes scopes/redirects and resets replay receipts so an explicit later replay can re-add it. It never edits application records. A stale/unknown ID fails without writes. Pure equivalents are `add(history, values, at)` returning the same envelope plus proposed history, and `remove(history, id, revision)` returning proposed history.
- `adopt(workspace, applications, at)` persists explicit application imports using `register_application`; an empty list writes nothing. It returns no payload. Existing source facts and assessments remain intact.

These helpers raise validation/read/write errors to callers. Canonical writes retain the atomic, single-writer and idempotency rules below. Existing pure `import_results`, `correct`, and `register_application` contracts remain available for owner-managed transformations.

## Inputs and operations

Python 3, standard library only. The sibling `jsf-search/scripts/jsf_search/evaluate.py` supplies criteria validation, timestamp parsing and stable identities. Keep the two skills together.

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

`list` and `review` return `{schema_version, vacancies}`. Each view includes ID, opaque revision, aliases, first/last observation times, last known raw fields with their observation times, availability, field conflicts, review choice/conflicts, and latest criteria-backed assessment. Missing incoming fields preserve older known values. Same-time contradictory fields remain unknown in the view and are retained in raw history.

The sole persisted file is `<workspace>/vacancies/history.json`: schema version, vacancies keyed by ID, old-ID redirects, search scopes and imported-input hashes, plus optional `rediscovery` identity groups for deliberately removed records. These groups contain only aliases/old IDs, not posting facts or application history. Rediscovery consumes them and restores identity redirects so preserved applications reconnect. Each vacancy retains unique posting observations and criteria-backed assessments with first/last observation timestamps. Repeated payloads extend their observation span. Older inputs enrich history without replacing newer facts. Writes replace this file atomically. Use one writer per workspace.

Records may also contain `overrides`, a field-to-`{value, at}` mapping of explicit user corrections. `correct(history, id, changes, at)` is pure and validates supported fields/URLs/work arrangements; empty strings explicitly clear a display field. `view` returns these separately as `corrections`. Consumers combine them with original fields for display, never rewrite observations or source-based assessments. A proven identity bridge retains the newest correction per field; contradictory simultaneous edits reject the merge.

`register_application(history, application, at)` supports an explicit UI import of application-only vacancies. A new record has application provenance and unverified source activity, without an invented assessment. Known identities are linked without replacing existing source observations. `at` is the import time, not an invented historical posting timestamp.

## Identity, scope and availability

Reuse search identity: source ID/canonical posting URL, shared application URL, or employer plus requisition ID. Never merge by company/title resemblance. Proven identity bridges merge saved records, preserve observations and redirect previous IDs. Conflicting explicit review choices are retained for the user to resolve through `review`; posting changes never reset a choice.

Absence comparisons use normalized mandatory search filters. Source/title/location/eligibility/compensation/technical exclusions remain part of scope. Target count, discovery budget, ranking preferences and conversion inputs do not. Equal-timestamp checkpoints accumulate seen IDs; older snapshots do not rewind latest scope presence. Limited or failed coverage cannot establish closure.

Availability values are `open` (explicit active flag), `closed` (explicit inactive flag), `available` (accessible description with unconfirmed activity), `unavailable` (HTTP 404), or `uncertain` (fetch failure/conflicting observations). A legacy 404 with `active: false` is still unavailable, not closed. The LinkedIn adapter now retains closure-banner evidence and does not treat HTTP 404 as closure. A newer accessible page alone does not prove reopening of a previously closed vacancy.

For standalone batch removal use `remove-many --workspace PATH --selections selections.json`. Revisions come from the current owner query/list. Successful output is `{schema_version: 1, removed: [IDs]}`; any invalid selection or failed publication leaves the saved history unchanged. Single remove/delete are wrappers over this same operation.

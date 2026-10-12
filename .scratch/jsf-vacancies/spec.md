# JSF Vacancies

Status: resolved

## Accepted scope

Own persistent vacancy history, deduplication across searches and change tracking in an explicitly selected workspace. Consume `jsf-search` results rather than retrieve listings or track candidacies. Use Python 3 helpers and versioned JSON exchanges; machine-generated history can remain JSON. Commit the completed skill and supporting docs before starting the next skill.

## Settled decisions

- A vacancy absent from a later search is not observed in that search; absence alone does not establish closure.
- Import every inspected vacancy, including search rejections and clarification cases. Retain assessment criteria and evidence so a later assessment can differ without losing history.
- Meaningful changes to advertised compensation, requirements, geographic restrictions or activity can make a seen vacancy appear in the changes report again. Repeated identical observations must not duplicate history entries.
- Output includes updated history and new, unchanged, changed, closed and uncertain vacancies.

## Final decisions and implementation

The user accepted Q18–Q21, then requested simplicity. Deliver one Python 3 helper and one JSON history file with three operations: import, list and review. No scheduler, database, migration framework or additional skill boundaries.

- Compare absence only within the same mandatory eligibility-filter scope, retaining coverage and treating missing listings as not observed. Ranking preferences, target count and effort/conversion inputs do not define a new scope.
- Store raw posting versions separately from criteria-backed assessments. Description changes capture pay, requirements and geographic restrictions; fit/check changes have a separate report.
- Missing data preserves known fields. Older imports enrich history without rewinding latest facts. Same-time field conflicts are reported without guessed resolution.
- Explicit `unreviewed`, `shortlisted` and `dismissed` review choices persist through posting changes and remain separate from application status.
- Stable source IDs, canonical URLs and proven cross-source aliases identify duplicates; company/title resemblance does not. Late identity bridges preserve history and redirect old IDs. Conflicting review choices require a new explicit user decision.
- Search now supplies uncapped assessments for all inspected groups. Legacy overflow remains unassessed instead of being silently lost or reevaluated here.
- LinkedIn retains explicit closure-banner evidence. HTTP 404 means unavailable, not closed; legacy false-active 404 records are handled conservatively too.
- Pure transformations copy inputs. CLI writes only the explicit workspace's `vacancies/history.json`, atomically. Exact input replays do not duplicate alerts or rewrite the file. One writer per workspace is sufficient for current on-demand execution.

## Implementation facts

Read-only inspection found:

- Raw snapshots retain all inspected records, descriptions, fetch statuses and interpreted facts. Result `matches` is capped at the target, so some qualifying assessments are absent from result lists even though their raw records remain.
- Source activity `false` currently comes from either a “no longer accepting applications” banner or a detail-page HTTP 404. Search evaluation calls both confirmed closed; vacancy history needs a distinction between explicit closure and unavailable URLs.
- `snapshot.observed_at` is generated at acquisition start and retained across current-run checkpoints. Records carry posting dates but no individual fetch/modification timestamps.
- Assessed groups preserve aliases, provenance, criteria and checks; these support importing history without reimplementing fit evaluation.

The importer must consume the full snapshot, preserve criteria-specific assessments, and explicitly represent unassessed qualifying overflow if no assessment was provided. Changing fit rules belongs to search, not vacancy history.

## Verification

- 14 vacancy-history tests passed: pure/repeated imports, uncapped and legacy assessments, posting versus fit changes, missing/old/conflicting data, scope-aware absence, closure/404 behavior, proven identity merges, redirects, preserved review choices and CLI persistence failures.
- All 34 search tests passed, including new tests for uncapped assessments and closure-banner versus HTTP 404 handling.
- Both skills passed `skill-creator/scripts/quick_validate.py`.
- Independent forward test used actual search evaluation and fresh synthetic evidence in a temporary workspace. Imported two jobs, shortlisted one, detected later posting/fit changes, retained the review choice, reported a missing job without closing it, and verified dry-run/replay/stale-review behavior. The sole persisted artifact was `vacancies/history.json`; no live source or repository state was changed by that test.

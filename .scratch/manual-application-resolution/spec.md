# Manual application resolution

Status: resolved

Follow-up to [application tracking](../application-tracking/spec.md). Implementation: [01 — Manual resolutions](issues/01-manual-resolutions.md). This spec supersedes the earlier spec's search-row editing restrictions, Expected salary text input and default Salary visibility.

## Agreed behavior

- Search applications allow a manual work-arrangement correction: one or more of Remote, Hybrid and On-site. A nonempty selection resolves the work-arrangement criterion as met, without comparing it against preferences or invoking AI. The table and expanded details show the corrected arrangements and a Manual badge where provenance is shown. Reset to original removes the override and restores the original value, evidence and assessment. An empty selection is not a new unknown assessment; use the explicit reset action.
- Expected salary becomes a structured positive amount, currency, pay period and contract type. All four are required for a structured value; clearing removes the value. Existing free text survives unchanged until explicitly replaced or cleared, and never qualifies through automatic parsing.
- For search applications, a structured Expected salary resolves an existing salary criterion as met with Manual evidence when it reaches the minimum of any compatible saved salary band. Currency, period and contract type must match exactly. Desired salary is not a ceiling. No conversions, AI calls or employer-pay inference.
- Clearing Expected salary, falling below every compatible minimum, lacking compatible bands or having no saved salary preferences removes this manual salary resolution and restores the original criterion. It never creates a new failed criterion. An originally passing salary assessment can continue to pass.
- Outcome and Open questions use the effective criteria. Remaining unknown criteria keep Needs clarification; all met criteria produce Match. Resolving arrangement changes only arrangement, including when a location criterion remains unknown. Missing employer salary keeps its existing outcome effect unless the salary criterion is manually resolved.
- Employer salary on search rows remains read-only and Salary is hidden by default, available through View. A manual salary resolution does not replace advertised compensation or claim an employer offer. Its detail explains that Expected salary meets the saved minimum.
- Manual applications remain Added manually, with no matching or generated open questions. Their existing manually entered advertised-salary field remains part of their facts. Structured Expected salary can be stored and displayed for them, but does not assess them.
- Saving salary preferences refreshes all search rows' Expected salary resolutions. Other assessments remain snapshots of the original search, and arrangement overrides remain in force. Application status, identity, deletion behavior and search memory do not change.

## Responsibilities and dependencies

### Persist original results and user input only

The application list owns persistence and validation. Keep each search row's original `job` and `match` unchanged. Persist the optional arrangement override and the Expected salary input alongside them. Never persist the effective criteria, effective outcome or a cached salary-qualification flag.

Keep persistence schemas separate from assessed response schemas so a derived Manual result cannot accidentally overwrite the original result. Existing workspaces remain readable: absent overrides mean no correction; legacy Expected salary strings are preserved. Use the existing migration and atomic-write conventions for any necessary format upgrade, preserving deleted fingerprints and all original assessments.

The list does not load preferences, run matching or maintain assessment copies. Search memory and the search workflow retain their current responsibilities.

### One pure assessment module in Applications

Add `web/src/modules/applications/model/manual-assessment.ts`. Its small interface accepts a stored search application and the saved salary bands it needs, then returns the effective assessment: arrangements, criteria with provenance, and outcome. No storage, network, React state, current time or AI dependencies.

Implementation rules:

1. Start from the original assessment without mutating it.
2. Apply the arrangement override to its criterion and displayed arrangements.
3. Apply the qualifying Expected salary resolution to its existing criterion; otherwise keep its original salary result. An absent original salary criterion stays absent.
4. Derive Outcome once from the effective criteria. Existing filtering of unknown salary from the Open questions count stays a table presentation rule; it must consume the effective criteria.
5. Use the same assessment for the table, expanded details and any response that exposes effective results. No second salary comparison or outcome calculation in dialogs or `rows.ts`.

Manual evidence belongs to the effective assessment contract. Original search evidence remains structured/model. Keep the shared currency/period/contract vocabulary already used by compensation contracts; do not introduce a second enum system or import Search's runtime matching implementation into Applications.

### Composition supplies saved preferences

`app/api/applications/route.ts` reads the original application list and the current published preferences, projects the salary bands and invokes the pure Applications assessment. It returns an explicit assessed view alongside the stored user inputs needed for editing. Never use recovery drafts as the salary baseline.

Read preferences once per load and assess all rows against that snapshot. Missing published preferences means no salary resolution. A malformed or unreadable preferences file must produce a surfaced error, not silently qualify rows or use a stale cached assessment. A later load uses the latest published snapshot; this design does not require cross-file write transactions.

Mutations keep their existing locked, atomic list writes and refetch behavior. Mutation responses must not expose a conflicting effective assessment: use the same assessment path if they include it, otherwise return stored data and rely on the canonical load for assessed results. Search streaming continues to invalidate and reload the list.

`app/workspace-content.tsx` wires a successful preferences-publication notification to invalidation of the current workspace's applications query. The notification occurs after an actual successful publish, including a publish during editor flush. Draft edits, discard and failed publishes do not trigger salary changes. Search does not import Applications; Applications does not import Search. Runtime cross-module composition stays in `app/`.

Refresh failures surface as application refresh errors without misreporting a successful preferences save as failed. Reloading the workspace retries the authoritative read. No preference-save code rewrites applications, so there is no half-completed two-file update.

## UI and contracts

- Add the arrangement control and Reset to original to the existing search-row edit dialog. Initialize from stored overrides rather than a formatted table label.
- Use structured Expected salary fields in the existing dialog. Preserve legacy text visibly until an explicit replacement or clear; do not guess currency, period or contract type from text.
- Validate allowed changes on the server using the row's origin schema. Clients cannot set original `job`, original `match`, effective criteria, evidence or outcome.
- Table formatting stays in `ui/application-table/rows.ts`; business assessment stays in the pure module. Dialogs edit user inputs and do not own assessment logic.
- Preserve original structured and AI badges; use Manual for overridden effective criteria. Reset restores the original badge as well as the result.
- Default Salary visibility is independent of whether a user has entered Expected salary.

## Required validation

- Arrangement correction changes display, criterion provenance and Open questions consistently; reset restores original data exactly. Another unknown criterion, including location, still prevents Match.
- Salary comparisons cover the exact minimum, above desired, below minimum, multiple bands, incompatible units, no saved bands and an absent original salary criterion. No conversions or AI calls occur.
- Salary transitions qualify → do not qualify → qualify and clear restore the correct original criterion, including an originally met result. Legacy text remains readable and does not resolve salary automatically.
- New published salary bands change the next load's effective results without changing application-file bytes. Draft bands have no effect. Multiple rows use one saved-preferences snapshot.
- Preferences publish refreshes applications through composition, including publish during flush; failed publish does not. Failed refresh is surfaced independently of publish success.
- Table, details and reload agree on effective assessment. Manual rows retain Added manually. Stored originals cannot be changed through update requests, and legacy files survive migration with no data loss.
- Keep existing concurrent list-write and search-workflow tests passing. Run from `web/`: `bun test`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`; exercise edits and resets in the browser on a fictional or copied workspace.

## Review fixes — 2026-10-23

All three ponytail design findings are addressed: original results are preserved beside user input; preference publication causes a read/refetch rather than application rewrites; one pure Applications module owns effective assessments. No matching-engine extension, background job, event bus or new dependency is needed.

Implemented on 2026-10-23. Stored v2 rows remain readable; list mutations write v3, preserving legacy text and original assessments. The applications load response contains a separate derived assessment. Preference publication refreshes the view through app composition.

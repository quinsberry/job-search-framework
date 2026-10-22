# Applications section

Status: ready-for-agent. Tracked as `issues/01-applications-section.md`.

## Objective and scope

Show the stored applications for the open workspace and let the job seeker start, watch and cancel a search run from the same place. The page's demo `Payment` table is replaced.

In scope: an `ApplicationsSection` composed in `WorkspaceContent`, the table columns and row expansion, run controls, a `sources` field on the load result, a `no-new` run reason, tests and docs. Out of scope: job-seeker statuses (applied, dismissed; next spec, likely a separate `statuses.json` keyed by fingerprint), incremental runs with `publishedAfter` (next workflow issue), bulk actions, persisted sort or filter state.

## Module layout (low coupling, high cohesion)

```text
web/src/modules/applications/
  applications-section.tsx      composes run controls + table for one workspace; owns loading/error/empty states
  ui/search-run.tsx             Search/Cancel button, live progress, done summary; only talks to useSearchRun
  application-table/
    rows.ts                     pure: Application + sources → row view model, default sort, done-summary text
    applications-table.tsx      generic table shell (renamed from applicaitons-table.tsx / AplicationsTable)
    applications-columns.tsx    column definitions over the row view model
    application-criteria.tsx    expanded row: the criteria list
    (existing header, pagination, view options, features files)
web/src/app/workspace-content.tsx   renders <ApplicationsSection key=… loaded=… />
web/src/app/page.tsx                demo data and the table removed
web/src/app/api/applications/route.ts   load also returns sources from listSearchSources()
```

- All display rules (labels, salary text, open questions, sort key, summary wording) live in `rows.ts` as pure functions; components only render their output. Columns read the view model, never raw `MatchResult` internals.
- `ApplicationsSection` depends only on Applications' own client hooks and contracts. Search, Profile and search-sources UI are not imported; the source names reach the client through the load result, so the UI follows the business layer and holds no source list of its own.
- Whether preferences are saved is not checked in the UI: the run route's preflight already answers 400 with a message, which the run controls show inline. This keeps the section from reaching into Search's client state.

## Contracts and server changes

- `loadResultSchema` gains `sources: SourceDescriptor[]` (reuse `sourceDescriptorSchema`). The load route fills it with `listSearchSources()`; it is the composition point, so Applications' store stays unaware of sources.
- `DoneEvent.reason` gains `no-new`: the pull cap stopped the run and it processed nothing. `process-budget` keeps meaning the process budget or the pull cap after at least one processed vacancy. Workflow test: a source of only known vacancies now ends with `no-new` (the existing pull-cap test is updated).

- `useSearchRun` gains three small things the controls need: `budgets` from the `started` event, a `cancelled` status when the client aborts (today it falls back to `idle` and the run's counts are lost), and clearing `lastDone`/`error` on start.
- `shortcut: the Arrangement column reads the "most likely: X" suffix that Search's matcher writes into the criterion detail; if a source starts supplying structured arrangements more often, or the wording changes, give MatchResult a structured field instead.` A `rows.ts` test pins the parse.

## Section layout

Section heading "Applications" with the run controls on the right, then a status line, then the table.

States, in order of precedence:

1. No workspace loaded → muted text "Open a workspace to see applications."
2. Loading → table skeleton (5 rows, `Skeleton` from `shared/components/ui`).
3. Load error → inline error message with a Retry button (`refetch`); the table is not rendered.
4. No applications → empty state "No applications yet. Run a search to find vacancies that match your preferences." with the Search button.
5. Otherwise → the table.

## Run controls (`ui/search-run.tsx`)

- **Search** button (primary). During a run it becomes **Cancel** (outline), no confirmation: cancelling keeps everything already found.
- While running: a status line `Inspected 12 / 50 · Found 3 / 10 · Skipped 40`, inside an `aria-live="polite"` region, plus a spinner on the button. Before the `started` event: "Starting…".
- Cancelling aborts the stream on the client, so no server `done` arrives; the line shows "Search cancelled" with the last progress counts and no cost.
- Preflight error (400 / 403 / 409 / 503) → inline destructive text with the server message; Search stays enabled.
- Done → the summary line from `rows.ts`, kept until the next run:

| Reason | Text |
| --- | --- |
| `match-budget` | Found N applications (limit reached) |
| `process-budget` | Inspected N vacancies (limit reached) |
| `no-new` | No new vacancies near the top of the results — try again later or broaden the position titles |
| `exhausted` | Searched all results |
| `cancelled` | Search cancelled |
| `failed` | the error message (destructive colour) |

  Followed by `· N inspected · N skipped · $0.0017` (cost to 4 significant digits; `+ N unpriced` when `unpricedCalls > 0`) and `· N jobs failed` / `· N sources failed` when non-zero.
- New rows appear while the run streams, because `useSearchRun` already invalidates the applications query.

## Table

Row identity is `fingerprint` (`getRowId`), so live refetches keep expansion, pagination and sort.

| # | Column | Content | Sortable |
| --- | --- | --- | --- |
| 1 | expand | chevron button, `aria-expanded`, `aria-label="Show criteria"` | no |
| 2 | Title | job title, link to `job.url` (new tab, `rel="noopener noreferrer"`, external-link icon) | yes |
| 3 | Company | `company.name`, or "—" | yes |
| 4 | Location | `locations[0].label`, ` +N` text when more; "—" when none | no |
| 5 | Arrangement | from `advertisedFacts.workArrangements` when present, else the `X` in the `workArrangement` criterion's "most likely: X" detail, else "Unknown" (muted) | no |
| 6 | Salary | first advertised compensation as `min–max CUR / period`, `from X` / `up to X` for one bound, ` +N` text when more; "Not advertised" (muted) | no |
| 7 | Outcome | badge: `Match` (default variant) / `Needs clarification` (secondary) | yes |
| 8 | Open questions | names of `unknown` criteria in plain words ("salary, seniority"); salary rendered muted as "salary not advertised" | no |
| 9 | Source | source name from `sources`, raw id when missing | yes |
| 10 | Published | relative date ("3 days ago", `Intl.RelativeTimeFormat`) in a `<time>` whose `title` holds the full date; "—" when null | yes |
| 11 | Found | `matchedAt`, same formatting | yes |

- **Default sort**: `match` first, then fewest non-salary open questions, then newest `matchedAt`. Choosing a column header replaces it; there is no "reset" control (reloading the section restores it).
- **Filter**: one text input, "Filter by title or company", case-insensitive substring match on either.
- **Column visibility**: the existing view options menu; all columns visible by default.
- **Pagination**: 20 rows per page, the existing pagination control.
- **Expanded row**: one full-width cell listing every criterion in the order the matcher returned them: an icon (met ✓, unknown ?, failed ✕) with a text label for screen readers, the criterion's plain name, the detail text, and a small "AI" badge when `evidence === 'model'`. Rows cost nothing to expand, so several can be open at once.
- The scaffold's selection checkbox column and Actions menu are removed.

## UX rules

- Every icon-only control has an accessible name; status is never colour-only (badges and icons carry text).
- Long titles and company names truncate with the full text in a `title` attribute; the table scrolls horizontally on narrow screens rather than wrapping columns.
- Progress and the done summary use the same line, so the layout does not jump between states.
- Errors say what to do next (the server messages already do; the load error adds Retry).

## Required checks

- `rows.ts`: arrangement precedence (advertised → model guess → unknown); salary text for range, single bound, several compensations and none; open questions with salary muted; default sort order; source name fallback; done-summary text for every reason including unpriced and failure counts.
- Workflow: only-known source ends with `no-new`; a run that processed something before the pull cap still ends with `process-budget`.
- Load route returns `sources` with LinkedIn's name.
- `useSearchRun`: `budgets` from `started`; client cancel ends in `cancelled` with the last progress kept.
- `ApplicationsSection` (react-test-renderer, mocked fetch): no-workspace text; rows rendered from a load; empty state; load error with Retry; Search → progress line → Cancel → summary using a fake NDJSON stream; preflight 409 message shown inline.

## Docs

- `web/README.md`: the Applications section — columns, run controls, what `no-new` means.
- ADR 0009: add `no-new` to the run's stop reasons.

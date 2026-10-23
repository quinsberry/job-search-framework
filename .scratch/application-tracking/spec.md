# Application tracking

Status: ready-for-agent. Tracked as `issues/01-storage-split.md` then `issues/02-tracking-ui.md`.

## Objective and scope

Let the job seeker track applications: give every row a status, record the salary they expect, add vacancies found elsewhere, edit and delete rows. Everything already stored survives, and deleting a row never makes the next search find it again.

Out of scope: status history and notes, fetching or matching manually added vacancies (paste-a-link matching is a later feature), bulk actions, persisted filters.

## Architecture (low coupling, high cohesion)

The single `applications/` store splits into two, each with one job and one owner:

| Store | Job | Owner | Lock |
| --- | --- | --- | --- |
| **Search memory** `<workspace>/search-runs/inspected.jsonl` | "has the search already judged this vacancy?" | the search workflow | the whole run |
| **Application list** `<workspace>/applications/applications.json` | the job seeker's rows | the application list | each write only |

```text
web/src/modules/applications/
  model/contracts.ts          row schemas (search/manual), status enum, per-origin edit schemas, actions
  server/fingerprint.ts       unchanged; also fingerprints manual rows
  server/search-memory.ts     replaces the index half of store.ts: prepare/has/record, pruning, migration of the old index
  server/application-list.ts  replaces the list half of store.ts: list/has/add/update/remove, v1 → v2 upgrade
  server/workflow.ts          deps: memory + Pick<ApplicationList, 'has' | 'add'>; knows nothing about statuses
  client/                     useApplications, useSearchRun, + useApplicationMutations
  application-table/          rows.ts, columns, table, dialogs (issue 02)
```

- The workflow sees the list only through `has` and `add`, so update and delete are out of its reach. The list knows nothing about matching; search memory knows nothing about rows.
- Which fields each kind of row may change is defined once in `contracts.ts` and used by both the route and the dialog: the server rejects read-only fields rather than the UI merely hiding them.
- The routes stay the composition root: the run route opens both stores, the applications route opens only the list.

## Search memory

Today's `inspected.jsonl` entry gains a third outcome:

```ts
type InspectedEntry = {
  fingerprint: string;
  outcome: 'accepted' | 'no-match' | 'closed';
  failed: Criterion[];          // [] for accepted
  criteriaDigest: string;
  inspectedAt: string;
  ref: JobRef;
};
```

- Every vacancy the workflow judges is recorded here, including `match` and `needs-clarification` ones (`accepted`).
- `prepare` prunes only `no-match` and `closed` entries (criteria digest changed, older than 60 days). `accepted` entries are never pruned, so a deleted row never returns.
- A vacancy is **known** to a run when its fingerprint is in search memory or in the application list (manual rows exist only in the list).
- Write order per accepted vacancy: add to the list, then record in memory. A crash between the two leaves a row that is still known through the list; never a remembered vacancy without its row.

## Application list

`applications.json` becomes `{ schemaVersion: 2, applications: Row[], deleted: string[] }` (`deleted` defaults to `[]`):

```ts
type Status = 'new' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'dismissed';
type Common = { fingerprint: string; status: Status; expectedSalary: string | null; addedAt: string };
type SearchRow = Common & { origin: 'search'; job: Omit<JobDetail, 'description'>; match: Match };
type ManualRow = Common & {
  origin: 'manual';
  url: string;              // httpUrlSchema
  title: string;            // 1–300
  company: string | null;   // ≤ 300, empty → null
  location: string | null;  // ≤ 300
  salary: string | null;    // ≤ 300, the advertised salary as the job seeker typed it
};
```

- `new` = found, not applied yet. `addedAt` replaces `matchedAt` (search rows: when matched; manual: when added).
- Every mutation runs under the list's lock: read the file, change it, write it atomically. A run adds rows the same way, so edits made during a run are never overwritten.
- Fingerprints stay unique. Manual rows use the same `fingerprint()` over company, title and location (the URL when there is no company); `add` and identity-changing `update`s that collide answer `conflict` (409).
- Editable fields, as per-origin schemas in `contracts.ts`:
  - search rows: `status`, `expectedSalary`;
  - manual rows: those plus `url`, `title`, `company`, `location`, `salary`; changing title, company or location recomputes the fingerprint.
  - never: `fingerprint`, `origin`, `addedAt`, `job`, `match`.
- `remove` deletes the row and adds its fingerprint to the list's `deleted` array (any origin), in the same write. `has` answers true for deleted fingerprints, so searches never bring a deleted row back, whoever added it.
- Adding a manual row for a deleted vacancy is allowed and removes its fingerprint from `deleted` (undo by re-adding).

## Migration (first open, under both locks)

1. If `applications/inspected.jsonl` exists: move it to `search-runs/inspected.jsonl`.
2. If `applications.json` is v1: write each application's fingerprint to search memory as `accepted` (current digest irrelevant; accepted entries are never pruned), then rewrite the list as v2 with `origin: 'search'`, `status: 'new'`, `expectedSalary: null`, `addedAt: matchedAt`.
3. Memory is written before the list is upgraded, so an interrupted migration reruns safely (duplicate memory lines are harmless).

## HTTP

`POST /api/applications`, same `localRequest` pattern, actions under the list lock (not the run lock):

| Action | Body | Result | Errors |
| --- | --- | --- | --- |
| `load` | `{ workspace }` | `{ applications, sources }` | — |
| `add` | `{ workspace, row: ManualInput }` | `{ row }` | 409 already listed |
| `update` | `{ workspace, fingerprint, changes }` | `{ row }` | 404 gone, 409 duplicate, 400 read-only field |
| `delete` | `{ workspace, fingerprint }` | `{}` | 404 gone |

The client refetches the list after each mutation.

## UI (issue 02)

- **Columns**: Status (inline select right after Title, saves on change) and **Expected salary** (text) are added; a ⋯ menu ends each row. Source and Published are hidden by default. Salary shows the advertised salary for search rows and the typed salary for manual rows.
- **Manual rows**: Outcome shows an "Added manually" badge, Open questions is empty, Source is "Manual", Found is `addedAt`; expanding shows "Added manually" instead of criteria.
- **Add application** button next to Search opens the row dialog empty (manual fields + status + expected salary). **Edit…** opens the same dialog with only that row's editable fields. **Delete…** opens a confirmation naming the job. Saves and deletes show a toast; a failed save keeps the dialog open with the server's message.
- **Status filter** beside the text filter: **Active** (default: new, applied, interviewing, offer), **All**, or one status. Not persisted.
- All display rules stay in `rows.ts`.

## Required checks

- Search memory: accepted entries survive digest change and 60 days; a vacancy recorded as accepted is skipped by the next run even after its row is deleted.
- Application list: add/update/remove; duplicate add and duplicate-producing edit → conflict; read-only fields rejected per origin; manual edit recomputes the fingerprint; a write during a run (interleaved with workflow adds) loses nothing.
- Workflow: manual rows are known; add-then-record order (crash between leaves the row known).
- Migration: a v1 workspace (index + 10 applications) upgrades with nothing lost; rerunning it is harmless; the old index file is gone.
- Routes: each action's success and error codes; mutations work while a run holds its lock.
- UI (issue 02): `rows.ts` for manual rows and the status filter; section test for add, inline status change, edit and delete with confirmation.

## Docs

- ADR 0010: search memory is separate from the application list — owners, lock scopes, why deleted rows do not come back, the add-then-record order.
- `CONTEXT.md`: add **Application status** (each value) and **Search memory**; point **Inspected vacancy** at search memory; **Application** now covers manually added rows.
- `web/README.md`: storage layout, the new actions, migration note.

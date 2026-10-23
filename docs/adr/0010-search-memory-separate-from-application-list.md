# Search memory is separate from the application list

Supersedes the storage part of ADR 0009.

The workspace keeps two stores with one owner each. **Search memory** (`search-runs/inspected.jsonl`) is the workflow's record of every vacancy it has judged, accepted ones included; a run holds its lock for the whole run. The **application list** (`applications/applications.json`) is the job seeker's rows: search results and manually added vacancies, each with a status and an expected salary. It is locked only for each write, which re-reads the file first, so a running search adds rows while the job seeker edits or deletes others and neither overwrites the other.

Deleting a row removes it from the list only. Search memory still knows the vacancy, so the next run skips it instead of finding it again; accepted entries are never pruned, while rejections still expire when criteria change or after 60 days. A vacancy is known to a run when either store has its fingerprint, which also keeps manual rows from being found twice. The workflow adds a row before remembering it, so a crash between the two leaves a row that is still known rather than a remembered vacancy with no row.

The workflow sees the list only through `has` and `add`; which fields each kind of row may change is one schema per origin, enforced by the server. Workspaces from before the split are migrated on first use: the index moves, v1 applications are remembered as accepted, and the list is upgraded with status `new`.

A single store locked for the run was rejected because it would block every edit while a search runs.

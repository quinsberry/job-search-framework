# 02 — Surface interrupted search runs and conversions after a server restart

Status: needs-triage
Type: task

Search runs (`SearchRun`, `modules/applications/server/workflow.ts`) and profile conversions keep their progress in memory. If the Bun server stops, the run or job is lost; for conversions this needs an explicit Retry (README, Run and check).

Search memory is written per judged vacancy, so a new run already skips work done before the interruption. The gap is feedback: the user should see that the last run or conversion was interrupted and be offered to restart it, rather than having to infer it.

Investigate what currently reaches the client when the stream dies mid-run (`useSearchRun` treats a stream closing without `done` as failed) and whether a lightweight run marker in the workspace is needed to report an interrupted run after a page reload. Do not add full restart resume or persisted source cursors.

## Comments

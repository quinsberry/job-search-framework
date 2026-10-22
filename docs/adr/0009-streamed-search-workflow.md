# Streamed search workflow with fingerprint dedup

A search run is one streamed `POST`: the route checks preconditions, holds the workspace's `applications` lock for the whole run and streams NDJSON events; cancelling the request or the response stream aborts acquisition and matching. There is no background job registry, so closing the tab stops the run. Results are written after every vacancy, so a stopped run loses nothing already inspected.

Each saved position title becomes its own discovery query, and the title runs alternate. Remote searches narrow only by country, because a remote vacancy listed in another city still qualifies. Seniority, salary and position type are left to matching.

A vacancy is identified before its detail fetch by a fingerprint of normalised company, title and first city (or country, or `remote`), falling back to the source identity when the company is unknown. Missing an alias costs an extra inspection; merging different openings would lose one, so identity stays conservative. Each inspected vacancy is written to exactly one file: rejected and closed vacancies to the `inspected.jsonl` index, applications to `applications.json`. Rejections carry a digest of the criteria that judged them and are re-inspected when criteria change or after 60 days; applications are never re-evaluated automatically.

Known vacancies use no budget. A per-run pull cap of five times the processing budget keeps reruns from paging through every source result. Model outages and rate limits stop the run; per-vacancy failures are reported and retried on the next run. Reported model cost is summed per run, with calls of unknown cost counted separately.

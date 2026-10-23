# Streamed search workflow with fingerprint dedup

A search run is one streamed `POST`: the route checks preconditions, holds the search memory lock for the whole run and streams NDJSON events; cancelling the request or the response stream aborts acquisition and matching. There is no background job registry, so closing the tab stops the run. Results are written after every vacancy, so a stopped run loses nothing already inspected.

Each saved position title becomes its own discovery query, and the title runs alternate. Remote searches narrow only by country, because a remote vacancy listed in another city still qualifies. Seniority, salary and position type are left to matching.

A vacancy is identified before its detail fetch by a fingerprint of normalised company, title and first city (or country, or `remote`), falling back to the source identity when the company is unknown. Missing an alias costs an extra inspection; merging different openings would lose one, so identity stays conservative. Where inspected vacancies and applications are stored is superseded by ADR 0010. Rejections carry a digest of the criteria that judged them and are re-inspected when criteria change or after 60 days; applications are never re-evaluated automatically.

Known vacancies use no budget. A per-run pull cap of five times the processing budget keeps reruns from paging through every source result. A run that hits the cap without processing anything ends with `no-new`, so the job seeker sees that nothing new is near the top of the results rather than a spent budget. Model outages and rate limits stop the run; per-vacancy failures are reported and retried on the next run. Reported model cost is summed per run, with calls of unknown cost counted separately.

# 26 — Simplify `useSearchRun` state and avoid a full list reload per found application

Status: needs-triage
Type: task

`useSearchRun` (`modules/applications/client/queries.ts`) keeps run state in six `useState` calls (status, progress, budgets, failures, last `done` event, error) that are reset together on start and updated together on events. On every `application` event it invalidates the applications query, so the server re-reads `applications.json` and the published preferences once per match.

1. Replace the six states with one `useReducer` over `RunEvent`s plus `start`/`cancelled`/`failed` actions. The reducer is pure and can be unit-tested without React.
2. Stop reloading the whole list per event: either throttle invalidation during a run (for example at most once per second, plus once on `done`), or insert the event's row into the cached list with `setQueryData` and reconcile on `done`. If inserting, the row must go through the same assessment projection as the load route (`assessApplication` with current salary bands), so throttling is the simpler choice.

Behaviour visible to the user stays the same: new applications appear during the run, and the final list equals what is stored. Done when the reducer has unit tests, `use-search-run.test.tsx` passes, and a run with many matches no longer issues one list load per match.

## Comments

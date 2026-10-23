# 12 — Rename modules and symbols whose names hide their responsibility

Status: needs-triage
Type: task

Several names collide with domain terms or with other files' conventions:

| Current | Problem | Proposed |
| --- | --- | --- |
| `modules/search/` | Holds search preferences (and matching until issue 03); the search run itself lives in `modules/applications` | `modules/preferences/` |
| `profile/server/application.ts` (`createProfileApplication`, `profileApplication`) | "Application" is the job-application domain term | `profile-service.ts` (`createProfileService`, `profileService`) |
| `applications/server/queries.ts` (`discoveryQueries`) | Every other `queries.ts` holds React Query options/hooks | `discovery-queries.ts` |
| `shared/search-sources/server/linkedin/search.ts` `runSearch` | Same name as the workflow's `runSearch` | `searchPage` (or similar) |
| `shared/search-sources/server/linkedin/helpers.ts` type `JobDetail` | Same name as the source contract `JobDetail` | file `parse.ts`, type `ParsedDetail` |

Update imports, tests, the README, `CONTEXT.md` and ADR references to these paths. Check terms against `CONTEXT.md` before finalising names. The `modules/search` rename touches the ESLint module list automatically, since boundaries are derived from the directory names.

Pure rename; no stored file formats or API routes change (`/api/search-preferences` stays). Prefer doing this after issue 03 so moved files are renamed once. Done when tests, typecheck, lint and build pass.

Blocked by: 03

## Comments

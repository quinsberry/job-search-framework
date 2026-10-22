# 01 — Search workflow, application store, routes and client hooks

Status: resolved
Type: task

Implement [the spec](../spec.md): `modules/applications/` contracts, fingerprint, `ApplicationStore`, `runSearch`, the `load` and `run` routes (with the local-request guard factored out of `shared/http/server.ts`), `useApplications` and `useSearchRun`, plus ADR 0009, `CONTEXT.md` and `web/README.md` updates. The applications table UI stays untouched.

Done when the spec's required checks pass with fake sources, a fake matcher and a temp workspace, and the web suite, typecheck, lint and build pass. No live source requests or model calls.

## Comments

### Implementation — 2026-10-22

Implemented `modules/applications/` contracts, fingerprint/digest/query helpers, `ApplicationStore`, `runSearch`, the load and run routes (local-request guard factored into `readLocalBody` + `errorResponse`; `WorkspaceFiles.append` added), `useApplications`/`useSearchRun`, ADR 0009, `CONTEXT.md` and README. Applications mirrors Search's match-result schema because modules share no runtime code; `workflow.ts` type-checks that the two stay in step.

Tests found and fixed two defects before shipping: `SearchRun.getDetail` rejects anything but a strict `JobRef` (the workflow passed the whole summary), and cancellation was only checked between pages. The fake run now validates refs strictly.

Validation: 158 tests pass (17 new), typecheck, lint (one existing warning in `preferences-fields.tsx`) and build pass. No live source or model calls; the route tests stub `fetch`.

### Smoke run — 2026-10-22

First live run (one LinkedIn title, 5 vacancies, $0.00032) worked end to end after replacing an OpenRouter management key with a regular key; model errors now carry the HTTP status and name a rejected key. All five vacancies were rejected on location: jobs elsewhere in Poland with an unknown work arrangement failed although the job seeker accepts remote. The matcher now keeps location unknown unless the vacancy is known not to be remote (ADR 0008 updated). Index entries now record failed criterion names, and the duplicate per-batch progress event is gone.

### Location strictness — 2026-10-23

The rerun kept an on-site Gdańsk and a hybrid Kraków vacancy for a Warsaw resident. LinkedIn guest pages omit the workplace type, and the guest search returns identical results for every `f_WT` value, so the adapter's `applied` workplace report was false. It now reports `unsupported` and stops sending the flag. The lenient location rule is reverted: a workplace elsewhere fails unless the vacancy is confirmed remote. A filter-as-evidence approach was tried and dropped for the same reason. Kept: query building moved to `queries.ts`, and `MATCHING_RULES_VERSION` in the criteria digest so rule changes re-inspect rejections. Structured workplace and salary data needs a richer source (issue 02, JustJoin.it).

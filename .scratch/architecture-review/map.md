# Architecture review — map

Review of the `web/` app's architecture (2026-10-23): structure, coupling and cohesion, responsibilities, extension points, and tooling to keep the target architecture in place. The app stays a local, single-user tool; hosting or multi-user scaling is out of scope and would need its own ADR.

Client-side architecture and React, Next.js, frontend and UX practices were reviewed as a second pass (issues 22–33).

Not yet reviewed: security in depth, performance, dependency hygiene.

## Order

Work top to bottom; within a phase, lower numbers first unless a `Blocked by` says otherwise.

### Phase 0 — make checks run

- [16 — CI checks](issues/16-ci-checks.md)

### Phase 1 — safety nets before refactoring

- [19 — Stored-format and digest fixtures](issues/19-stored-format-fixtures.md): land before 03, 09, 11 and 12, which touch the schemas that read workspace files.
- [14 — Decision model identity in the criteria digest](issues/14-decision-model-identity-in-criteria-digest.md): updates the digest pinned by 19 once, deliberately.
- [01 — Matching accuracy evaluation](issues/01-matching-accuracy-evaluation.md): product priority; independent of the refactors.

### Phase 2 — structure

- [05 — One Zod import path](issues/05-consistent-zod-import.md)
- [03 — Domain layer for sources, AI and matching](issues/03-domain-layer-for-sources-and-ai.md): records ADR 0011.
- [10 — Split decision model port and adapter](issues/10-split-decision-model-port-and-adapter.md): after 03.
- [11 — Split applications contracts](issues/11-split-applications-contracts.md)
- [06 — Run preconditions and NDJSON helper](issues/06-run-preconditions-and-ndjson-helper.md)
- [07 — Typed error codes](issues/07-typed-error-codes.md)
- [08 — Validated server config](issues/08-validated-server-config.md)
- [09 — Narrow preferences input for applications](issues/09-applications-narrow-preferences-input.md): blocked by 06.
- [12 — Clarifying renames](issues/12-clarifying-renames.md): blocked by 03.
- [15 — Provider UI metadata coverage](issues/15-provider-ui-metadata-coverage.md)

### Phase 3 — architecture tooling

- [17 — ESLint architecture rules](issues/17-eslint-architecture-rules.md): incremental; each rule lands with the issue it enforces.
- [18 — Adapter conformance suites](issues/18-adapter-conformance-suites.md)
- [20 — Architecture fitness test](issues/20-architecture-fitness-test.md): blocked by 03, 06, 09.
- [21 — Dead code check and architecture guide](issues/21-dead-code-check-and-architecture-guide.md): blocked by 16.

### Phase 4 — client side

Draft editors first (22 unblocks 23 and 24), then the independent items.

- [22 — Shared draft editor hook and snapshot commit](issues/22-shared-draft-editor-hook.md)
- [23 — Consistent external-change detection](issues/23-consistent-external-change-detection.md): blocked by 22.
- [24 — Leave-guard registry](issues/24-leave-guard-registry.md): blocked by 22.
- [25 — Shared NDJSON client](issues/25-shared-ndjson-client.md): pairs with 06.
- [26 — Search run state and list refresh](issues/26-search-run-state-and-list-refresh.md)
- [27 — Application actions hook](issues/27-application-actions-hook.md): low priority.
- [28 — Remember the selected AI provider](issues/28-remember-selected-ai-provider.md)

### Phase 5 — Next.js, React and UX practices

- [29 — Next.js app shell](issues/29-nextjs-app-shell.md): metadata, error boundaries, template leftovers, offline fonts.
- [30 — React Compiler evaluation](issues/30-react-compiler-evaluation.md): research.
- [31 — Dark mode decision](issues/31-dark-mode-decision.md)
- [32 — Page layout for daily use](issues/32-page-layout-for-daily-use.md): grilling; depends on 24 for flushing drafts between views.
- [33 — Accessibility audit](issues/33-accessibility-audit.md)

### Product follow-ups

- [02 — Interrupted run and conversion feedback](issues/02-interrupted-run-feedback.md)
- [04 — Live source check](issues/04-live-source-check.md)

### Closed

- [13 — Application table helpers](issues/13-application-table-label-and-date-helpers.md): wontfix; helpers have a single consumer.

## Decisions so far

Resolved tickets add a one-line summary here and link back.

- [16](issues/16-ci-checks.md) (ready-for-agent): replace the Python `tests` workflow with `web / checks` (typecheck, lint, test, build in one job); push to `main`, PRs and manual dispatch; skip non-code-only changes; no pre-push hook; done on the PR that merges `next-migration`.

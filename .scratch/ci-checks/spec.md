# CI checks for the web app

Status: ready-for-agent

Source: [architecture review issue 16](../architecture-review/issues/16-ci-checks.md) and its triage decisions (2026-10-24).

## Problem Statement

As the maintainer of the job search web app, I rely on typecheck, lint (including the architecture boundary rules), the test suite and the production build to keep the app healthy, but nothing runs them unless I remember to. The web app's history has no CI at all. The default branch still carries a `tests` workflow from the retired Python framework, which runs suites that do not exist in the web app and will fail as soon as the web app is merged. Every architecture safeguard planned in the review (stricter ESLint rules, conformance suites, fitness tests, dead-code checks) is only worth something if it runs automatically on every change.

## Solution

Replace the Python workflow with a single GitHub Actions workflow, `web`, whose one job, `checks`, installs the web app's dependencies from the lockfile and runs typecheck, lint, tests and build in order, failing at the first broken step. It runs on pushes to `main`, on every pull request and on manual dispatch. Automatic runs skip changes that touch only non-code files, and manual runs always run everything. It needs no secrets, uses a read-only token, caches Bun's install cache, cancels superseded pull-request runs and times out after 15 minutes. Pull requests show one check, `web / checks`, that tells me whether the change is safe to merge.

## User Stories

1. As the maintainer, I want every pull request checked automatically, so that I don't have to remember to run four commands before merging.
2. As the maintainer, I want every push to `main` checked, so that I notice a broken default branch at once.
3. As the maintainer, I want to start a run by hand, so that I can re-check `main` or a branch without pushing a dummy commit.
4. As the maintainer, I want a manual run to always run every check, so that a manual run never silently skips work.
5. As the maintainer, I want the obsolete Python workflow removed, so that the first CI run after the merge doesn't fail on suites that no longer exist.
6. As the maintainer, I want a single, stable check name (`web / checks`), so that I can make it a required check and recognise it in the PR UI.
7. As the maintainer, I want the TypeScript typecheck to run, so that type errors cannot be merged.
8. As the maintainer, I want lint to run over the real source tree, so that a feature module importing another feature's runtime code fails CI.
9. As the maintainer, I want the boundary-rule tests and the rest of the suite to run, so that regressions in behaviour or in the lint configuration are caught.
10. As the maintainer, I want the production build to run, so that build-only failures (server/client boundaries, route config) are caught before merge.
11. As the maintainer, I want the cheapest checks to run first and the job to stop at the first failure, so that I get feedback quickly and runners are not wasted.
12. As the maintainer, I want dependencies installed strictly from the lockfile, so that CI fails when the lockfile is out of date instead of silently resolving new versions.
13. As the maintainer, I want CI to use the same Bun version as the project declares, so that local and CI results agree and I upgrade Bun in one place.
14. As the maintainer, I want Bun's install cache reused between runs, so that reruns are faster.
15. As the maintainer, I want pull requests that change only Markdown, the issue tracker, docs or the licence to skip the checks, so that writing issues and docs doesn't cost CI time.
16. As the maintainer, I want changes to the workflow itself, the web app, its lockfile or its config to always run the checks, so that the filter never hides a real change.
17. As the maintainer, I want a docs-only pull request never to be left with a pending required check, so that I can merge it without overriding protection.
18. As the maintainer, I want a newer push to a pull request to cancel that PR's older run, so that I only wait for the run that matters.
19. As the maintainer, I want runs on `main` never cancelled, so that every commit on the default branch has a complete result.
20. As the maintainer, I want the job to time out after 15 minutes, so that a hung build cannot burn hours of runner time.
21. As the maintainer, I want the workflow token restricted to reading contents, so that a compromised step cannot write to the repository.
22. As the maintainer, I want CI to need no secrets, so that it works on forks and leaks nothing.
23. As the maintainer, I want the opt-in live checks (matching accuracy evaluation, live source check) kept out of CI, so that CI stays deterministic and free of network-dependent flakiness and API costs.
24. As the maintainer, I want proof that a real boundary violation turns the check red, so that I trust a green check means the architecture rules held.
25. As a future contributor or agent, I want the stricter checks added by later architecture issues to run automatically once they're part of lint or tests, so that they need no extra CI wiring.

## Implementation Decisions

- **Replace, don't add.** The Python `tests` workflow is deleted rather than adapted. A new workflow named `web` with a single job named `checks` takes its place, so the PR check reads `web / checks`.
- **Triggers.** Push to `main`, `pull_request` (all target branches), and `workflow_dispatch`. Pushes to other branches are covered by their pull requests. A push-trigger for the migration branch was considered and rejected.
- **One job, ordered steps.** Inside the web app directory, in this order: frozen-lockfile Bun install, TypeScript typecheck without emit, lint, test suite, production build. No parallel jobs, because one install is cheaper for a repo this size.
- **Bun version.** Read from the `packageManager` field (`bun@<version>`) of the web app manifest; not hard-coded and not `latest`.
- **Cache.** Bun's install cache, keyed on the web app's lockfile.
- **Non-code filter.** Changes touching only `**/*.md`, `.scratch/**`, `docs/**` or `LICENSE` skip the checks on push and pull-request runs. Manual dispatch ignores the filter. By default the filter is trigger-level path ignores. If the maintainer makes `web / checks` a required check, the filter moves inside the workflow: a step or job always reports a result, and only the checks are skipped, so a docs-only PR passes instead of staying pending.
- **Concurrency.** Grouped by workflow and ref; `cancel-in-progress` only for pull-request events.
- **Permissions and limits.** `contents: read` only; job timeout 15 minutes; no secrets or environment variables.
- **Network.** Install needs registry access and build needs Google Fonts access; GitHub-hosted runners provide both. Self-hosting fonts is tracked separately.
- **No pre-push hook.** A local lefthook hook was considered and dropped; reopen as its own issue if CI failures become frequent.
- **Branch protection is a human step.** If `main` requires the old `tests` check, the maintainer swaps it for `web / checks` after the first green run and tells the implementer, which selects the in-workflow filter.

## Testing Decisions

- A good test here observes external behaviour: the reported state of the `web / checks` check on real pull requests and pushes, not the contents of the workflow file.
- **Primary seam: the `web / checks` result on a real PR.** Verify each scenario on the PR that merges the web app into `main`, or on short-lived PRs:
  - the merge PR is green;
  - a temporary commit adding a runtime import from one feature module into another fails at the lint step, then is reverted and never merged;
  - a PR touching only Markdown or `.scratch/` skips the checks and leaves no pending required check;
  - a manual dispatch runs all steps;
  - a second push to a PR cancels the first run, while runs on `main` are not cancelled.
- **Existing seam reused: the ESLint boundary-rule tests**, which already assert in table form that the config rejects cross-feature runtime imports and server code outside server folders. CI runs them through the test suite; no change needed.
- No new seams: no workflow linter in CI, no tests of the workflow file, no local Actions runner.
- Local verification was not possible during triage (no installed dependencies, no registry access); the first green PR run is the proof that the suite starts green.

## Out of Scope

- A pre-push or pre-commit hook.
- The opt-in live checks: matching accuracy evaluation and live source check.
- Self-hosting fonts so the build works offline (architecture review issue 29).
- Changing branch protection settings.
- Any change to the app's code, tests or lint rules, including the stricter architecture rules planned in architecture review issues 17–21.
- Deployment, release or preview environments; the app is a local, single-user tool.

## Further Notes

- The web app lives on `next-migration`, which has diverged from `origin/main` (still the Python framework, with two merged PRs). The CI change lands with, or before, that merge; resolving the divergence itself is not part of this spec.
- Later architecture issues (17, 18, 20, 21) add their checks to lint or the test suite and rely on this workflow to run them.

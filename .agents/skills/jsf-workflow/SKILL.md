---
name: jsf-workflow
description: Find new jobs using an existing workspace profile/config, open the local editable vacancy tracker, or show tracked jobs with application status. Coordinate profile export, vacancy search, saved history and application records through their owning Python helpers. Use for requests such as find 10 new jobs using my profile or open my job-search table.
---

# Local job-search workflow

Require an explicit workspace; ask only if it is missing. This repository's local app combines the existing specialists. Use Python 3 in an environment with `jsf-profile/scripts/requirements.txt` installed. The local CLI integration requires `codex` on PATH signed in using ChatGPT; API-key authentication is deliberately not used. Run `codex login` in the user's terminal when needed. Never read, copy or expose their credentials.

Paths below use the repository root (three parents above this skill directory):

```sh
rtk proxy <python3> app/server.py --workspace /chosen/workspace
rtk proxy <python3> .agents/skills/jsf-workflow/scripts/workflow.py list --workspace /chosen/workspace
rtk proxy <python3> .agents/skills/jsf-workflow/scripts/workflow.py find --workspace /chosen/workspace --count 10
```

Open the server's printed loopback URL in the harness browser preview or an ordinary browser. The user can select a workspace, edit fields, check/uncheck Applied, and filter their cumulative table without further AI turns. Profile/config setup still belongs to `jsf-profile`; report missing required choices rather than inventing them. A supported partial profile is usable.

`find` exports current YAML for each run. N means N newly discovered qualifying jobs, excluding all existing history identities and application records, including ready/unsubmitted ones. It continues acquisition past already-known matches, until N new matches or the configured discovery/source limit. A requested count changes only that run. An automatic discovery budget follows N × 10; an explicitly configured smaller budget is never silently increased. A request larger than that budget runs within it and reports a shortfall.

Python fetches source records and invokes Codex only for evidence interpretation. Quotations and fit are validated by `jsf-search`; `jsf-vacancies` imports every inspected record, including clarification and rejected cases. These remain visible with their fit labels, although only new matches count toward N. Save completed batches; on failure report that earlier batches may already be saved. Never loosen filters, submit applications or send recruiter messages.

Manual corrections use vacancy history's correction contract; submission/application changes use the application owner's tracking contract. Original observations and fit are read-only. Unchecking is a correction to not-applied, distinct from withdrawal; later-stage progress requires explicit confirmation and is retained. A checkbox alone leaves unknown salary/dates/interview fields blank. Existing application-table upgrades need the user's explicit approval and make a backup. Multiple candidacies require selection before editing; do not choose one by recency or title resemblance.

Read [references/contracts.md](references/contracts.md) for persistence, output, concurrency and testing. Changes to workspace data are not source-code changes or git commits.

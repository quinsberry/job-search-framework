---
name: jsf-workflow
description: Find new jobs using an existing workspace profile/config, open the local editable vacancy tracker, or show tracked jobs with application status. Coordinate profile export, vacancy search, saved history and application records through their owning Python helpers. Use for requests such as find 10 new jobs using my profile or open my job-search table.
---

# Local job-search workflow

The CLI remains `scripts/workflow.py`. Python callers use `jsf_workflow` under `scripts/`; its explicit dependencies are sibling `jsf-search`, `jsf-profile`, `jsf-vacancies` and `jsf-application`. It resolves these namespaced packages itself. Compose the owners' query/edit interfaces instead of reading observation/redirect storage layouts. Specialist entrypoints must also work without this coordinator being initialized.

Require an explicit workspace; ask only if it is missing. This repository's local app combines the existing specialists. Use Python 3 in an environment with `jsf-profile/scripts/requirements.txt` installed. The local CLI integration requires an AI CLI on PATH: `codex` signed in using ChatGPT, or `claude` (Claude Code) signed in with a Claude subscription. API-key, gateway and cloud-provider authentication is deliberately not used, except Claude Code on Amazon Bedrock as an explicit opt-in (`--claude-auth bedrock` or `JSF_CLAUDE_AUTH=bedrock`, with `CLAUDE_CODE_USE_BEDROCK=1` and AWS variables). `--ai-provider codex|claude` or `JSF_AI_PROVIDER` selects one; otherwise the first installed is used, Codex first. Run `codex login` or `claude auth login` in the user's terminal when needed. Never read, copy or expose their credentials.

Paths below use the repository root (three parents above this skill directory):

```sh
rtk proxy <python3> app/server.py --workspace /chosen/workspace
rtk proxy <python3> .agents/skills/jsf-workflow/scripts/workflow.py list --workspace /chosen/workspace
rtk proxy <python3> .agents/skills/jsf-workflow/scripts/workflow.py find --workspace /chosen/workspace --count 10
```

Open the server's printed loopback URL in the harness browser preview or an ordinary browser. The user can select a workspace, add/remove vacancies, edit fields, choose Application status, and filter their cumulative table without further AI turns. Profile/config setup still belongs to `jsf-profile`; report missing required choices rather than inventing them. A supported partial profile is usable.

The app's profile and preferences buttons run guided setup through the profile owner's Python helpers. `scripts/jsf_workflow/setup_sessions.py` persists independent profile and preferences drafts per workspace, structured questions/answers, and review state. Each setup card shows its own progress and next action. The user can close/resume, revise, explicitly retry interrupted interpretation, or cancel. Processing shows confirmed stages and elapsed time; saved profile readiness is unchanged until Save. Only the final Save applies owner plans; completing setup never starts a search. Details are in [references/guided-setup.md](references/guided-setup.md).

`find` exports current profile Markdown/evidence and search YAML for each run. N means N newly discovered qualifying jobs, excluding existing history identities and application records, including ready/unsubmitted ones, except vacancies explicitly removed for rediscovery. It continues acquisition past already-known matches, until N new matches or the configured discovery/source limit. A requested count changes only that run. An automatic discovery budget follows N × 10; an explicitly configured smaller budget is never silently increased. A request larger than that budget runs within it and reports a shortfall.

Python fetches source records and invokes the selected AI CLI only for evidence interpretation. Quotations and fit are validated by `jsf-search`; `jsf-vacancies` imports every inspected record, including clarification and rejected cases. The default table shows matching, manual and application-linked vacancies; Show all inspected exposes rejected/uncertain records with clear search-fit labels, although only new matches count toward N. Save completed batches; on failure report that earlier batches may already be saved. Never loosen filters, submit applications or send recruiter messages.

Manual corrections use vacancy history's correction contract; submission/application changes use the application owner's tracking contract. Original observations and fit are read-only. Changing Application status to ready corrects submission to not-applied, distinct from withdrawal; later-stage progress requires explicit confirmation and is retained. Selecting applied leaves unknown salary/dates/interview fields blank. Existing application-table upgrades need the user's explicit approval and make a backup. Multiple candidacies require selection before editing; do not choose one by recency or title resemblance.

Read [references/contracts.md](references/contracts.md) for persistence, output, concurrency and testing. Changes to workspace data are not source-code changes or git commits.

Search now defaults to at most five AI batches per run; the UI's Max AI batches or CLI `--max-ai-calls N` overrides it. Zero uses scripts and reusable facts only and needs no AI login. Python skips known listings before AI unless compatible saved facts can be reevaluated; it never replaces a known assessment with empty facts. AI runs only for unresolved new listings, with the compact annotation contract. An exhausted allowance stops with `ai_limit` and an explicit shortfall; deferred postings are not saved as tracked vacancies, so a later run can inspect them. Usage reports AI batches/listings, scripted/reused/skipped/deferred counts and provider-reported tokens where available; characters are not tokens or subscription quota.

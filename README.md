# Job Search Framework

Local-first vacancy discovery and application tracking, built around modular Python skills.

## Run the local app

See [the app's manual run guide](app/README.md) for first-time setup, workspace selection, stopping/restarting and port options.

```sh
python3 -m venv .venv
.venv/bin/python3 -m pip install -r .agents/skills/jsf-profile/scripts/requirements.txt
codex login
.venv/bin/python3 app/server.py
```

Open **http://127.0.0.1:8765** and enter your job-search workspace folder. Alternatively, pass `--workspace /absolute/path` at startup. Choose ChatGPT when signing into Codex; this app doesn't use API-key billing. Codex must be installed separately. It uses the official CLI's non-interactive structured-output mode: [official documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

Set up the workspace first with `jsf-profile`: import your PDF/Markdown CV and complete the required choices in `search-config.yml`. You can ask the agent: “Set up my job-search profile from `/path/CV.pdf` in `/path/workspace`.”

The Search setup checklist explains what is ready or blocking search. Click **Set up profile** to choose a PDF/Markdown CV or reuse an imported one. Click **Set search preferences** to answer the search-choice forms. The dialog collects answers, shows a draft for review, and changes active files only when you click **Save profile/preferences**. Amber profile warnings permit search; red blockers must be resolved. Recheck setup also refreshes Codex login status.

Close the dialog to browse your jobs and use **Continue setup** later. Submitted answers survive refreshes and server restarts; interrupted AI steps offer Retry. Back/Revise let you change answers. Cancel discards the draft. Profile and preferences have independent drafts. Uploaded CVs must be under 10 MB and have readable text; OCR is not included. CV interpretation uses your connected Codex subscription; preference forms run in Python without an AI call. Setup completion refreshes readiness and does not automatically search.

You can open an existing profile with **Edit profile** and edit its Markdown directly. **Save profile** validates and applies manual edits without AI or a separate revision question. Save edits before refreshing the page to preserve them across restarts.

A saved profile can still be amber when details such as skill proficiency are unknown. The card shows counts and expandable **View details** explaining each warning; these do not block searching. Saving does not invent missing facts or mark them complete.

The app keeps one cumulative table. Edit a field and leave it to save; check Applied to record your own submission. Date, salary and interview details can remain unknown. Use All / Not applied / Applied filters and expand Details for longer fields and original evidence. The UI reports failed saves and retains the edit for retry.

“Find N” aims to add N **new qualifying** jobs, excluding all previously tracked identities and application records, including ones not yet submitted. Search can return fewer when LinkedIn access, required evidence, Codex usage limits or the discovery budget prevent reaching N. Rejected/uncertain inspected listings are retained too, with their fit labels. Original evidence and assessed fit stay separate from your corrections. Existing application-only records can be explicitly brought into the editable table with its import button.

Data stays in the chosen workspace: profile Markdown with supporting evidence, search-config YAML, vacancy history JSON and application CSV. There is no saved profile JSON cache. Legacy profiles migrate with backups on the first successful save. Existing application tables require an explicit upgrade confirmation and get a backup before adding stable vacancy links/submission flags. Run one writer per workspace; keep a backup of your workspace.

The app runs locally and makes external requests to LinkedIn and Codex when searching. It never submits applications or contacts recruiters. Hosted multi-user service, Claude integration and OCR are deferred.

## Checks

```sh
.venv/bin/python3 .agents/skills/jsf-workflow/scripts/test_workflow.py
.venv/bin/python3 app/test_server.py
```

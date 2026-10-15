# Job Search Framework

Local-first vacancy discovery and application tracking, built around modular Python skills.

## Run the local app

```sh
rtk proxy python3 -m venv .venv
rtk proxy .venv/bin/python3 -m pip install -r .agents/skills/jsf-profile/scripts/requirements.txt
rtk proxy codex login
rtk proxy .venv/bin/python3 app/server.py
```

Open **http://127.0.0.1:8765** and enter your job-search workspace folder. Alternatively, pass `--workspace /absolute/path` at startup. Choose ChatGPT when signing into Codex; this app doesn't use API-key billing. Codex must be installed separately. It uses the official CLI's non-interactive structured-output mode: [official documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

Set up the workspace first with `jsf-profile`: import your PDF/Markdown CV and complete the required choices in `search-config.yml`. You can ask the agent: “Set up my job-search profile from `/path/CV.pdf` in `/path/workspace`.”

The Search setup checklist explains what is ready or blocking search. Use **Copy setup request** to paste a repair request into your agent, then **Recheck setup** after changes. Amber profile warnings permit search; red blockers must be resolved. Rechecking also refreshes Codex login status.

The app keeps one cumulative table. Edit a field and leave it to save; check Applied to record your own submission. Date, salary and interview details can remain unknown. Use All / Not applied / Applied filters and expand Details for longer fields and original evidence. The UI reports failed saves and retains the edit for retry.

“Find N” aims to add N **new qualifying** jobs, excluding all previously tracked identities and application records, including ones not yet submitted. Search can return fewer when LinkedIn access, required evidence, Codex usage limits or the discovery budget prevent reaching N. Rejected/uncertain inspected listings are retained too, with their fit labels. Original evidence and assessed fit stay separate from your corrections. Existing application-only records can be explicitly brought into the editable table with its import button.

Data stays in the chosen workspace: professional YAML, search-config YAML, vacancy history JSON and application CSV. There is no saved profile JSON cache. Existing application tables require an explicit upgrade confirmation and get a backup before adding stable vacancy links/submission flags. Run one writer per workspace; keep a backup of your workspace.

The app runs locally and makes external requests to LinkedIn and Codex when searching. It never submits applications or contacts recruiters. Hosted multi-user service, Claude integration and OCR are deferred.

## Checks

```sh
rtk proxy .venv/bin/python3 .agents/skills/jsf-workflow/scripts/test_workflow.py
rtk proxy .venv/bin/python3 app/test_server.py
```

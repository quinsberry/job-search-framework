# Run the local app manually

Run these commands from the **`app/` directory**. If your terminal is already there, stay there. If you are at the repository root, first run:

```sh
cd app
```

The commands below use standard tools; `rtk` is not required to run the app. The [repository README](../README.md) provides alternative commands for running from the repository root; do not mix the two sets of paths.

## First-time setup

You need Python 3. Create a Python environment inside `app/` and install the dependencies. If you already created `app/.venv`, skip the first command:

```sh
python3 -m venv .venv
.venv/bin/python3 -m pip install -r ../.agents/skills/jsf-profile/scripts/requirements.txt
```

CV interpretation and job discovery also need the Codex CLI installed and signed in with your ChatGPT account:

```sh
codex login
```

Manual editing of an existing profile and search preferences works without Codex. The app uses the CLI's login; you do not enter credentials or an API key in the browser.

## Start the app

```sh
.venv/bin/python3 server.py
```

Keep that terminal running, then open **http://127.0.0.1:8765** in your browser. There is no frontend build or separate frontend server.

To open an existing workspace immediately:

```sh
.venv/bin/python3 server.py --workspace "/absolute/path/to/job-search-workspace"
```

The workspace must be an existing folder. In the UI, use **Select workspace** to choose one, or enter its path and click **Open workspace**. **Browse…** lets you choose another folder. The native picker opens on the computer running the app; if unavailable, enter the path manually.

## Set up and use your workspace

The setup points are ordered as follows:

1. **Workspace opened** — the folder holding your job-search files.
2. **Codex connected** — use **Recheck setup** after signing in.
3. **Candidate profile** — import a PDF/Markdown CV, or edit your existing profile. Imported CVs can be reused. Ordinary manual edits save without AI.
4. **Search preferences** — configure roles, compensation, work arrangements and other search criteria in the forms. No CV upload is required.

Profile and preferences have separate drafts. Closing a dialog keeps submitted progress; active information changes only after **Save**. Unsaved editor text must be saved before refreshing or closing the browser.

The first successful save of a legacy profile converts it to `candidate/profile.md`, retaining evidence separately and backing up the previous files. Opening a workspace does not migrate its profile.

Once setup is ready, enter a count and click **Find opportunities**. The table retains tracked vacancies across searches. Edit table fields to save changes, and check **Applied** to record that you submitted an application yourself.

## Stop, restart or change the port

Press **Ctrl+C** in the server terminal to stop. Run the startup command again to restart; workspace files and submitted setup drafts persist. Restart after changing Python code, and refresh the browser after changing UI files.

If port 8765 is already occupied, use another port:

```sh
.venv/bin/python3 server.py --port 8766
```

Then open **http://127.0.0.1:8766**. Run one app process per workspace.

The app binds to the local computer only. CV interpretation and job searches make external requests to Codex and job sources; the app never submits applications or contacts recruiters.

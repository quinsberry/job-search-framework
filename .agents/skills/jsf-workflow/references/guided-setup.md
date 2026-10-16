# Local guided setup

The first guided workflows are `profile` and `config`, both owned by `jsf-profile`. This is not a general agent shell or an arbitrary-skill execution endpoint. The existing specialist helpers remain independently usable.

## Sessions

`scripts/jsf_workflow/setup_sessions.py` composes profile owner operations. `workflow/setup-profile-draft.json` and `workflow/setup-config-draft.json` each store a version-1 draft with a random session ID/revision, kind, state, submitted answers, source snapshots, transcript and proposal. It is nonauthoritative and must never be consumed as a candidate export. Public responses omit private proposals/base snapshots and include only display state/questions/review/source choices. Completion replaces the draft with a small receipt; cancellation discards draft content.

States are `source`, `questions`, `processing`, `review`, `failed`, `complete`, `cancelled`. Each kind has its own nonterminal session. Starting or resuming preferences never opens a profile draft. Legacy setup-draft.json remains readable until that kind is written to its new path. All mutations require the session ID and current revision; stale tabs cannot submit over another tab's answers. Background AI results are accepted only while their original session revision remains current. Cancel terminates its Codex turn and prevents late results being stored. A server restart changes orphaned processing to a retryable failure without losing submitted answers. Unsubmitted form edits are not persisted.

Profile sources can be reused from canonical snapshots or uploaded as PDF/Markdown up to 10 MB. New files are staged under `workflow/setup-inputs/<session-id>/`. No readable text means no profile success; OCR is unsupported. The profile owner stores a reusable original and snapshot under candidate/sources before interpretation. Cancellation removes workflow staging when safe, while owner sources remain reusable.

Preference questions are deterministic Python forms with typed inputs, explicit no-preference choices and existing values. Back navigation preserves prior submitted answers; final cross-field validation failures retain the final answers and permit repairing earlier steps. Profile interpretation uses structured questions with custom answers and optional skips. Previously skipped questions are suppressed by ID/label. Both flows require a final preview and explicit Save. External profile/config changes reject stale saves; Review against current files rebuilds the draft for another review.

## HTTP/UI

Profile review uses an editable Markdown textarea. Existing profiles open directly in review, without CV selection or AI. Save accepts optional `text`, validates it through the profile owner, and applies on the same explicit action. `POST /api/setup/markdown` optionally validates/updates a review draft without saving active facts or calling AI. Invalid edits stay in the browser editor, with errors; unsubmitted edits survive closing/reopening within the page and warn before unloading. Profile and preferences drafts are independent. Import another CV is a separate `import_cv` action. Config editing uses existing typed preference forms.

`GET /api/setup?path=...&kind=profile|config` reads/resumes display state. `POST /api/setup/start` accepts workspace and kind. `POST /api/setup/{source,answer,back,edit,rebase,retry,markdown,import_cv,save,cancel}` requires workspace, id, revision and the action's typed data. Source takes either source_id or `{upload:{name,data}}`, with base64 data. Answer takes `{answers:{question_id:value}}`. Errors use the app's existing JSON error contract and leave active files intact unless a user-authorized Save itself encountered a partial filesystem failure.

All writes retain local Host, same-origin and session-token checks. Only source upload has a larger (15 MB JSON) request limit; other requests remain below 1 MB. Files are never served through an arbitrary-path endpoint. The browser uses native dialog/forms and text rendering; models do not supply executable HTML.

Profile AI calls use a separate `codex_bridge.guided_profile` structured-output operation with ChatGPT authentication, isolated temporary cwd, read-only sandbox, no-tool prompt, cancellation and a five-minute deadline. Each user submission drives one bounded turn. The model proposes facts/questions; Python validates and persists. The vacancy-only interpretation contract remains unchanged. Provider login remains owned by the installed CLI, outside this app.

## Checks

Run `scripts/test_setup_sessions.py`, the profile owner suites, and `app/test_server.py`. Mock AI for deterministic workflow tests; use fictional source documents for live subscription/browser checks. No live job discovery is needed to verify setup.

Search setup displays Workspace opened → Codex connected → Candidate profile → Search preferences. Workspace is required for edits; Codex is required only for CV interpretation and discovery. Manual editing does not require an AI connection. An empty workspace input offers Select workspace; a populated input offers Open workspace and Browse. POST /api/select-workspace opens a native chooser on the server computer, protected by the same local/session/origin checks. Cancellation changes no selection. Unsupported environments retain manual path entry.

## Setup feedback

Each setup card shows saved readiness separately from its unfinished draft. Actions address the owning kind explicitly: View progress, Answer questions, Review profile/preferences, Continue preferences/profile, or View import issue. There is no generic draft banner. Closing never cancels a running turn, and completion never opens a closed dialog.

CV source validation/staging returns a processing session before extraction runs in its background worker. Version-1 public sessions add optional phase (reading, preparing, validating, ready, failed), started_at (UTC ISO timestamp), failure_detail and can_retry. The browser shows a sending indicator while reading/sending the local file. Server phases advance only on confirmed extraction/AI/validation boundaries; no percentage is estimated. A one-second local elapsed display and one-minute slow hint use started_at. Refresh retains server timing; legacy drafts without timing show activity without an invented elapsed value.

Polling continues for any processing draft, even when the other editor is selected or the dialog is closed. Progress-only updates preserve the answer revision so Cancel remains valid; final results still require the original ID/revision and an uncancelled worker. Extraction runs outside the workspace lock. Cancellation prevents late results replacing receipts; already imported owner sources remain reusable. Errors/timeouts retain inputs and offer an explicit retry; reconnecting progress polling never starts another AI turn. Technical failure details are expandable beneath a plain-language explanation.

Preferences readiness exposes plain-language guidance plus optional diagnostics for troubleshooting. Missing fields and owner validation stay unchanged; presentation never guesses choices or changes saved information. Existing usable profile readiness is independent of a replacement CV's processing/failure state.

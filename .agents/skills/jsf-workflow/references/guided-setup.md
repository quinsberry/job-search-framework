# Local guided setup

The first guided workflows are `profile` and `config`, both owned by `jsf-profile`. This is not a general agent shell or an arbitrary-skill execution endpoint. The existing specialist helpers remain independently usable.

## Sessions

`scripts/jsf_workflow/setup_sessions.py` composes profile owner operations. `workflow/setup-draft.json` stores a version-1 draft with a random session ID/revision, kind, state, submitted answers, source snapshots, transcript and proposal. It is nonauthoritative and must never be consumed as a candidate export. Public responses omit private proposals/base snapshots and include only display state/questions/review/source choices. Completion replaces the draft with a small receipt; cancellation discards draft content.

States are `source`, `questions`, `processing`, `review`, `failed`, `complete`, `cancelled`. At most one nonterminal session exists per workspace. All mutations require the session ID and current revision; stale tabs cannot submit over another tab's answers. Background AI results are accepted only while their original session revision remains current. Cancel terminates its Codex turn and prevents late results being stored. A server restart changes orphaned processing to a retryable failure without losing submitted answers. Unsubmitted form edits are not persisted.

Profile sources can be reused from canonical snapshots or uploaded as PDF/Markdown up to 10 MB. New files are staged under `workflow/setup-inputs/<session-id>/`. No readable text means no profile success; OCR is unsupported. Cancellation removes staged uploads unless an earlier Save attempt already referenced them in the active profile. Saved profiles retain their uploaded source files.

Preference questions are deterministic Python forms with typed inputs, explicit no-preference choices and existing values. Back navigation preserves prior submitted answers; final cross-field validation failures retain the final answers and permit repairing earlier steps. Profile interpretation uses structured questions with custom answers and optional skips. Previously skipped questions are suppressed by ID/label. Both flows require a final preview and explicit Save. External profile/config changes reject stale saves; Review against current files rebuilds the draft for another review.

## HTTP/UI

Profile review uses an editable Markdown textarea. `POST /api/setup/markdown` takes the normal workspace/id/revision plus `text` (nonblank, at most 200,000 characters). Review changes persists the submitted text before a bounded interpretation turn, then returns to review; Save remains a separate explicit action. Failed interpretation retains the editable submission and supports correction/retry. Unsubmitted edits survive closing/reopening the dialog in the same page, with an unload warning; submission is required for restart persistence. Source history and active artifacts remain unchanged until Save. Config review still uses the typed preference forms.

`GET /api/setup?path=...` reads/resumes display state. `POST /api/setup/start` accepts workspace and kind. `POST /api/setup/{source,answer,back,edit,rebase,retry,save,cancel}` requires workspace, id, revision and the action's typed data. Source takes either source_id or `{upload:{name,data}}`, with base64 data. Answer takes `{answers:{question_id:value}}`. Errors use the app's existing JSON error contract and leave active files intact unless a user-authorized Save itself encountered a partial filesystem failure.

All writes retain local Host, same-origin and session-token checks. Only source upload has a larger (15 MB JSON) request limit; other requests remain below 1 MB. Files are never served through an arbitrary-path endpoint. The browser uses native dialog/forms and text rendering; models do not supply executable HTML.

Profile AI calls use a separate `codex_bridge.guided_profile` structured-output operation with ChatGPT authentication, isolated temporary cwd, read-only sandbox, no-tool prompt, cancellation and a five-minute deadline. Each user submission drives one bounded turn. The model proposes facts/questions; Python validates and persists. The vacancy-only interpretation contract remains unchanged. Provider login remains owned by the installed CLI, outside this app.

## Checks

Run `scripts/test_setup_sessions.py`, the profile owner suites, and `app/test_server.py`. Mock AI for deterministic workflow tests; use fictional source documents for live subscription/browser checks. No live job discovery is needed to verify setup.

# Guided profile and preference setup

Status: resolved

## Agreed scope

The user accepted Q1–Q8 and confirmed implementation. Replace clipboard setup requests with working UI actions. Add workflows one at a time, beginning with profile intake and search preferences; other JSF skills follow separately.

- Structured question dialog with choices, custom answers and PDF/Markdown file selection or reuse.
- Submitted answers persist across page closure, refresh and server restart; interrupted AI steps resume through Retry.
- One unfinished setup per workspace; opening another setup continues the existing one, which can be cancelled.
- Drafts leave active configuration unchanged until a final preview and explicit Save.
- Optional questions can be skipped; supported no-preference choices are explicit. Required choices must be answered. Facts are never invented.
- Cancellation discards unfinished drafts. Existing owner artifacts and tracked jobs are preserved.
- Completion refreshes the readiness checklist without automatically starting discovery.
- Profile and config remain owned by jsf-profile; the workflow coordinator handles sessions and invokes owner operations. Python 3 handles all mechanics; AI only interprets source-backed professional facts.

## Implementation

Owner helpers: `jsf-profile/scripts/guided_setup.py`; current search-config validation extracted into a reusable pure document check. Comment-preserving YAML edits use ruamel.yaml. Existing profile planner/apply and quotation validation remain authoritative.

Coordinator: `jsf-workflow/scripts/setup_sessions.py` stores a nonauthoritative `workflow/setup-draft.json`, stages uploads separately, checks revisions, and composes bounded Codex interpretation turns. UI: native modal/forms in `app/static/setup.js`, existing local server routes/token protection.

## Verification

- 122 unit/HTTP tests pass across search, history, profile, config, coordinator and guided sessions; application CSV checks pass. Both JavaScript files pass syntax checks, and both updated skills pass quick validation.
- Independent fictional-workspace testing verified grounded intake, resumability, explicit save, cancellation, stale-file rejection/rebase and comment preservation. Its reported cross-field recovery problem was fixed with Back navigation and retained final answers, then independently rechecked.
- Browser checks verified preference edit/review/save and readiness refresh, configured default count, Back, cancellation, native CV selection, custom question answers, reload/resume, review/save and 390px layout without horizontal overflow.
- Actual PDF text extraction through the upload path was verified separately. A live Codex subscription interpreted a fictional CV and an explicit correction into validated review drafts without writing an active profile.
- No real candidate workspace data or live job discovery was changed by testing. Login remains owned by the Codex CLI; other guided JSF workflows are deferred.

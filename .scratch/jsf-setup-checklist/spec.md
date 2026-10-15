# Visible search setup readiness

Status: resolved

## Problem

The user opened the local app, found Find opportunities disabled and an empty table, and could not tell which setup requirement was missing.

## Requested outcome

Show a compact setup checklist with visible states, such as workspace connected and profile configured. Explain blockers and how the user can resolve them without inspecting source files.

## Constraints

- Keep the UI and skill responsibilities simple and modular.
- Read current profile/configuration through their owning Python helpers.
- Do not equate optional unknown profile facts with a search blocker.
- Do not claim external sources are reachable merely because configuration is valid.

## Decisions

The user accepted Q1–Q3 and implementation:

- Always-visible checklist for workspace, usable candidate profile, search preferences and Codex login.
- Green ready, red blocked, amber usable with warnings, gray not checked; icons and text supplement colors.
- Exact blocker messages, copyable agent setup requests and Recheck setup. No new profile editor.
- Empty table distinguishes setup incomplete, ready without saved results, and no filter matches.
- Disabled Find explains its reason. Search activity stays separate from setup.
- Checks are read-only and independent of tracker loading, and recheck refreshes Codex login.

## Verification

- 11 HTTP tests and 14 workflow tests pass; JavaScript syntax and whitespace checks pass.
- Browser verified the current workspace's partial-profile warning and exact missing search choices.
- Temporary workspaces verified ready/blocked empty states, rechecking an edited configuration, and copyable setup requests.
- At 390px viewport width, the page has no horizontal overflow.
- No live discovery or AI interpretation was triggered; existing user workspace files were unchanged.

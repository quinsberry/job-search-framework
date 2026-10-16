# Editable local search setup

Status: resolved

## Agreed scope

The user confirmed the design and authorized implementation with “go”. The UI is a convenient interface to independent skill operations and sources.

- Show four ordered setup points: Workspace opened, Codex connected, Candidate profile, Search preferences. Workspace is required for editing; AI connection is required only for AI work.
- Reuse previously imported CVs; preferences never require a CV. Keep independent drafts for profile and preferences.
- Open existing profiles as editable readable Markdown and existing preferences as typed forms. Validate/save ordinary manual edits without AI; preserve unchanged evidence and treat changed claims as explicit corrections.
- Make candidate/profile.md authoritative with predictable sections and fields. Keep sources/provenance in supporting files without a parallel set of current profile facts.
- Migrate legacy YAML/README only on a successful profile save, with backups and preserved facts, unknowns and provenance. Reads make no migration writes.
- Empty workspace input offers Select workspace using a native folder chooser. Populated input offers Open workspace and a browse action. Cancellation changes nothing; retain manual path entry.
- Python3 owner helpers implement parsing, persistence, migration, source reuse and OS folder selection. Keep existing CLI entrypoints and specialist boundaries. Verify and commit.

## Implementation

Markdown publication references immutable evidence metadata by digest, allowing one atomic replacement of the authoritative file. Metadata contains evidence and fingerprints rather than duplicate current fact values. Legacy artifacts are backed up before publication and removed afterwards; an interrupted save can be retried. Owner source imports retain reusable originals independently of active profile facts.

Setup sessions are addressed by kind and ID/revision. Existing single-draft files remain readable. The app uses owner render/edit-plan/apply operations for manual edits and keeps CV interpretation separate.

## Verification

146 automated tests and the application CSV checks passed. All six skills passed validation; both UI JavaScript files passed syntax checks. Native chooser command/results and cancellation were checked with mocked OS responses, and the HTTP picker endpoint rejects unauthorized/cross-origin calls.

Browser checks used a fictional workspace with Codex deliberately disconnected: Select/Open labels and ordered setup rendered, existing profile opened without a CV prompt, direct edits saved and persisted on reopen, and preferences opened independently while a profile draft existed. Picker selection was mocked in this browser fixture; no native dialog, live AI or job source was used.

An independent forward pass additionally verified read-only legacy loading, successful backed-up migration, unchanged original evidence, separate draft persistence, invalid/stale-save rejection and reuse of a cancelled CV upload.

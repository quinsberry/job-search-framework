# Candidate Profile in the Next.js app

Status: ready-for-human

Implementation plan approved and implemented on 2026-10-18. Standards and Spec reviews completed; all findings corrected. Ready for human review.

## Settled scope

Implement web/src/modules/profile/candidate-profile.tsx as an inline upload and structured field editor using the existing shadcn/Base UI system.

This is an independent TypeScript/Bun implementation. The Python app is a behavior reference only. Do not reuse Python scripts, apps, APIs, configuration, storage contracts or unfinished drafts. This user decision supersedes the earlier compatibility proposal and Markdown storage requirement for this new app; leave the Python implementation unchanged.

- Store the authoritative profile in human-readable YAML in the selected workspace.
- No Projects or experience-location fields, including hidden passthrough data.
- Upload PDF/Markdown; selection starts conversion when workspace and AI prerequisites are satisfied.
- Show observable processing phases, elapsed time, errors and explicit Retry.
- Successful conversion reveals a collapsed field editor at the bottom of the section. No raw Markdown/YAML preview, summary or editor.
- Users edit individual fields and add/remove repeatable entries. Missing facts are corrected in the form, without an AI question wizard.
- First conversion produces an unpublished draft with Save enabled. Saving publishes it; subsequent differences from the saved baseline enable Save again.
- Preserve drafts, edits, source files and completed conversion results. Refresh never starts another AI call.
- Another upload produces a replacement draft; the saved profile remains unchanged until Save. Confirm replacement of unsaved changes.
- Provide a small pluggable AI interface, implemented for Codex initially. Claude remains disabled.
- Upload requires a loaded workspace and available AI connection. Editing and saving a saved profile work without AI.

## Current facts and dependencies

CandidateProfile is a placeholder with unused handlers referencing undefined selectedAgent. WorkspaceSection and ActiveAgentSection keep isolated state; Load Workspace and Connect only log. There is no connection logic to reuse.

Bun, Zod, React Hook Form and its resolver are installed. Existing UI includes Card, Field, Input, Select, Checkbox, Button, Badge, Separator, Dialog, Item and Toast. Button has a local isInProgress prop. UploadFileButton exists but needs configurable accepted types, label and disabled state.

Add only shadcn Collapsible and Textarea. Do not create custom replacement UI primitives or a generic form-component framework. PDF extraction needs a JavaScript dependency; proposed pdfjs-dist, subject to a Bun/Next compatibility check before integration.

## User flow

1. Explain missing workspace/AI prerequisites beside disabled Upload CV. Existing profile editing stays available without AI.
2. Loading a workspace reads the saved profile and any new-app draft. Distinguish saved-profile status from unfinished-draft status.
3. Upload CV opens a PDF/Markdown picker. Cancellation changes nothing. Validate file type, bytes, readability and size server-side before AI work.
4. Show uploading/reading, converting and validating stages only when observable. Use a spinner, elapsed time and slow-operation hint; no invented percentages.
5. On success, show an unsaved-draft status and a collapsed “Edit candidate profile” panel. Expanding shows all supported fields grouped into six sections.
6. Save is actionable for unpublished or changed data, and disabled while submitting. Invalid submission retains values, shows field errors and focuses the first error.
7. Save validates and atomically publishes YAML, updates the baseline and disables Save until another change. Reverting all edits to the baseline also disables Save.
8. Collapsing preserves values. Closing the page does not cancel server processing. Failed conversion, validation or publication preserves saved data and recoverable work.
9. Another upload confirms replacement if necessary. Keep prior saved data and the prior editable draft until the new conversion succeeds.

## Schema changes

Keep schema.ts as the single validation definition and inferred CandidateProfile type. Use it at form, storage and AI boundaries, with a separate permissive draft representation for incomplete extraction/editing.

- Keep Identity, Experience, Skills, Education, Certifications and Languages only.
- Keep full name required for publication; fix its message to “Full name is required”. Missing full name after extraction still yields an editable, recoverable draft.
- Allow missing contact/location details and education degree/field. Validate email/URLs when supplied; normalize empty optional controls to omitted values.
- Preserve existing meaningful record requirements such as company/role or institution in the publication schema. Partial extracted records remain editable until corrected or removed.
- Make achievements and technologies string arrays. Edit one item per row or line; avoid lossy comma splitting.
- Preserve date precision as strings: year, year-month, full date, or explicitly ongoing end date. Validate actual dates without inventing precision or forcing a date picker.
- Accept only unknown (empty string), A1, A2, B1, B2, C1, C2 and Native for language proficiency. Use a fixed selector without a free-text field; never infer a level from a description.
- Retain certification credential ID/URL and experience description from the supplied schema; no legacy mapping is needed.
- Store stable repeated-record IDs and source/conversion metadata outside editable facts. Use React Hook Form field arrays and stable row keys.
- Version persisted envelopes. Reject unsupported versions/unexpected stored fields with actionable errors instead of silently stripping data.

## Storage and recovery

Proposed new-app namespace, separate from the Python app's artifacts:

- candidate-profile/profile.yaml: authoritative facts wrapped with schemaVersion.
- candidate-profile/draft.yaml: partial values, recovery state and revisions.
- candidate-profile/sources/<content-hash>.<extension>: original CV bytes.
- candidate-profile/conversions/<cache-key>/: extracted text, conversion output and operation metadata.

Use Bun runtime YAML parsing/serialization with readable block indentation. Read workspace files dynamically, not through bundled imports. Parse and validate on the server. Keep partial dates and phone numbers as strings. App Save may regenerate YAML formatting/comments; value preservation is the contract.

Keep content hash, provider/model settings, prompt/schema versions, job ID, stages and errors in internal metadata. Persist expensive-stage results before acknowledging completion. Cache reuse requires matching source bytes and conversion settings, stays within the workspace, and must not overwrite newer edits.

Debounce draft persistence and flush on controlled workspace changes. Show recovery-write failures. Autosaving drafts never publishes profile.yaml. A crash can lose the most recent unacknowledged keystrokes, but must not lose an acknowledged conversion result.

Use atomic temporary-file replacement, serialized writes and expected revisions. On external-file/second-tab conflicts retain edits and require explicit reload/review. On interrupted processing reuse committed checkpoints and require explicit Retry. An unfinished AI response cannot be promised token-free recovery. Never read or migrate Python artifacts.

## Implementation sequence

### 1. Schema and repository contracts

Update schema.ts. Define versioned YAML, partial drafts, processing states, revisions and typed errors. Add focused schema/YAML tests covering missing values, lists, source-precision dates, phone strings and invalid/unknown fields.

### 2. Shared workspace and minimum Codex connection

Share loaded-workspace and selected-provider state through a narrow client boundary around existing sections. Distinguish selecting a directory from successfully loading it. Validate and scope filesystem operations server-side.

Replace Connect logging with a server-side Codex availability/login check that does not start interpretation or consume conversion tokens. Show checking/available/not authenticated/unavailable states. Keep manual login; do not build an authentication product.

Define a small server-only provider interface for readiness and profile conversion, including cancellation and observable progress. Codex implements it first. Providers return data; the profile repository owns files and publication. No Claude implementation or general plugin framework.

### 3. YAML repository, draft operations and background jobs

Implement cohesive server modules under modules/profile for validated load/save, sources, recovery and conversion checkpoints. Put genuinely shared AI code outside profile where ActiveAgentSection needs it.

Expose typed operations for load, start/upload, status, persist draft, retry, discard and publish. Use a server-owned background job independent of the initiating HTTP request. Poll only active work; polling never starts conversion.

Target the existing local Bun-run Next.js app. On server restart recover persisted results and explicitly classify abandoned jobs as interrupted, without automatically repeating paid work. Verify this lifecycle before UI integration.

Apply local-only/same-origin protections to filesystem/process endpoints. Validate workspace containment, requests, filenames and sizes. Use structured subprocess arguments rather than shell interpolation.

### 4. CV extraction and Codex conversion

Extend UploadFileButton with label, accept and disabled/pending support. Accept .pdf, .md and .markdown; proposed limit is 10 MiB, checked server-side.

Read Markdown directly as text. Verify pdfjs-dist on representative PDFs under Bun/Next before integrating it; resolve any incompatibility before continuing. No Python fallback. Reject encrypted, malformed, empty or image-only PDFs with actionable errors. OCR is excluded.

Verify installed Codex CLI flags and structured-output behavior during implementation. Add timeout/cancellation, bounded inputs and strict output validation. Treat document contents as untrusted; interpretation must not have workspace-write or unrelated tool permissions. Partial/raw output is separate from accepted results.

Coalesce duplicate submissions and reuse valid checkpoints before spending tokens. Malformed output or failed interpretation requires explicit Retry. Keep usable results even if browser delivery fails.

### 5. Inline editor

Compose CandidateProfile from installed UI primitives and existing form libraries. Add only shadcn Collapsible and Textarea.

Use React Hook Form/Zod for validation and dirty tracking, field arrays for repeated records, Input for short values, Textarea for long/list values and Select plus a custom value for language levels. Do not introduce generic wrappers or custom toast/loading primitives.

Show all six sections, with Add actions for empty lists. Keep examples as help rather than actual defaults. Initially collapse after conversion. Preserve values across collapse; defer mounting form content where useful.

Reuse Dialog for replacement/discard confirmation, Button's existing loading API, Field feedback, Badge and Toast. Persistent errors also need visible text. Provide labels, stable control IDs, keyboard access, predictable focus and accessible status announcements.

### 6. Recovery, retry and publication integration

Keep saved-profile readiness independent from draft/conversion status. Serialize mutations; ignore stale workspace/job responses and guard against late acknowledgments overwriting newer edits.

Implement explicit retry from reusable checkpoints and explicit draft discard. Preserve conversion caches for reuse. Save validates and compares revisions before atomic publication, without calling AI. Reset the saved baseline without erasing edits made during an in-flight request.

### 7. Verification

Use fictional fixtures and temporary workspaces, with mocked provider calls. Do not touch real candidate files or spend live conversion tokens without separate authorization.

- Schema/YAML: supported fields, missing values, lists, dates, phones, malformed YAML and unsupported versions.
- Workflow: upload, prerequisites, first Save, edits/add/remove, dirty-state reversal, validation and saved-profile editing without AI.
- Cost/recovery: refresh never reruns AI; duplicate upload reuses results; explicit retry resumes committed stages; server interruption does not trigger paid work.
- Preservation: failed replacement/save retains data; concurrent tabs/external changes conflict safely; stale responses cannot affect another workspace.
- UI: collapse retains input; keyboard/mobile behavior, status announcements and error focus work.
- Run focused Bun tests, existing directory-picker checks, TypeScript, lint and production build. Separate pre-existing failures. No Python regression suite is required for this independent feature.

### 8. Documentation

Document YAML shape/paths, Codex prerequisites, local runtime/job recovery and PDF limits. Record the new web storage decision in a root ADR and distinguish this app's profile model from the Python framework in domain documentation; preserve Python contracts.

## Exclusions and review

No Python integration or compatibility migration, Projects, experience location, raw document editor, AI question wizard, automatic CV merging, OCR, Claude implementation, hosted deployment or applications-table changes.

All interview decisions are reflected above and approved. Exact module filenames, PDF extractor compatibility and installed Codex flags are implementation verification tasks, not unresolved product decisions.

## Implementation verification

- All 27 web tests passed, including the existing directory-picker checks.
- TypeScript and production build passed. Feature-scoped and full ESLint passed; the applications table retains its pre-existing unused-import warnings. The reused Button received an equivalent children-markup correction to clear its pre-existing JSX lint error.
- Production-server smoke test used a fake Codex executable: real PDF extraction, conversion, duplicate upload cache reuse, recovered manual edit and YAML publication passed with exactly one mocked conversion and no live AI tokens.
- Browser checks with a fictional workspace confirmed draft recovery after reload, Save publication/disabled state, visible invalid-link feedback and focus, and profile controls within a 390px viewport. The existing applications table causes page-level overflow. Preview screenshots were unavailable.
- No Python code, real candidate data, or live conversion calls were used.

## Source references

- web/src/modules/profile/schema.ts
- web/src/modules/profile/candidate-profile.tsx
- web/src/modules/workspace-section.tsx
- web/src/modules/active-agent-section.tsx
- web/src/shared/components/upload-file-button.tsx
- https://bun.sh/docs/runtime/yaml
- https://ui.shadcn.com/docs/components/base/collapsible
- https://ui.shadcn.com/docs/components/base/textarea

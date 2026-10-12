# JSF Profile

## Current extension

The user moved CV-to-search-config setup into this existing skill rather than creating a separate `jsf-config`, and requested removing the stale JSON artifact. `jsf-profile` now owns `search-config.yml` alongside professional facts and README. The new config contract and decisions are recorded in `.scratch/jsf-config/spec.md`.

Persist only canonical professional YAML and generated README; JSON is an on-demand validated export of current YAML, never a saved cache. Apply/render remove a legacy `candidate/profile.json`; read-only export does not mutate files. Historical references below to three persisted views describe the initial implementation, superseded by this extension.

Status: ready-for-agent
Implementation: complete

## Accepted scope

First skill to deliver under the modular workflow plan. Accept a PDF or Markdown CV plus explicit corrections/additional facts and an explicit workspace. Own the candidate's source-backed professional facts: experience, skills, projects, education and languages.

Return structured profile data, a readable `candidate/README.md` and extraction ambiguities. `candidate/profile.yaml` is the editable canonical profile; JSON is its validated execution/inter-skill representation. Markdown is generated, not an independently maintained source. Preserve the distinction between candidate facts, search criteria and vacancy-specific application materials.

All scriptable mechanics use Python 3. Evidence interpretation is separate from deterministic validation, persistence and rendering. The skill must support natural-language requests to import a CV or create/update a candidate profile.

## Settled behavior and confirmation

- Support text-layer PDFs and Markdown; scanned, locked or unreadable sources require clarification instead of an empty successful import. OCR is outside this version.
- Missing facts remain unknown while a partial nonempty profile remains usable. Downstream skills request missing facts relevant to their tasks.
- Preserve prior facts and explicit corrections when importing a revised CV. Omitted history is retained; conflicts are presented for resolution. Explicit user corrections replace or clear affected facts.
- The user accepted all remaining decisions and confirmed implementation on 2026-10-12.

## Implementation and verification

- Added the naturally discoverable skill, maintained input/output contracts, Python 3 helper and dependency requirements for PyYAML/pypdf.
- Implemented extraction, read-only merge planning, revision-checked application, read-only export and deterministic view regeneration.
- Source-page quotations ground facts; user-statement evidence is required for explicit corrections. Sources, prior records and omitted list entries are preserved, and conflicting claims remain visible.
- Canonical YAML owns the profile; execution JSON and README are generated views. Friendly headings and reverse-chronological experience presentation make the README readable. Individual files are replaced atomically; the set of three is not a filesystem-wide transaction.
- All 24 behavioral tests passed, including real text-layer PDFs, unreadable/encrypted sources, partial profiles, source preservation, user corrections, conflicting imports, unsafe YAML rejection, stale plans and idempotent replay.
- Independent forward testing imported a full CV, imported a shorter revision, applied an explicit title correction and replayed exports/views. Six records and omitted history were preserved, the conflict was resolved, and replay produced byte-identical output. Its presentation feedback was addressed with readable headings and chronological ordering.
- Skill-creator validation and `git diff --check` passed. Verification used an isolated Python environment; no actual candidate data was imported into the repository.
- The user requires each completed skill creation to be committed before moving to the next skill; this is recorded in project authoring conventions.

## Delivery boundary

Implement and verify this skill before starting the next. No other skill implementation is included in this delivery.

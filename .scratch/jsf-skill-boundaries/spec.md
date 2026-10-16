# Skill cohesion and coupling assessment

Status: resolved

## Request

Assess whether the six skills under `.agents/skills` are independent and maintain high cohesion and low coupling. The user invoked grill-with-docs and agreed to the scoped boundary repairs below.

## Findings

Responsibilities and canonical artifact ownership are mostly cohesive. However, the skills are not all self-contained installable folders, and some callable helpers rely on ambient import setup. Low coupling is only partially achieved.

| Skill | Cohesive responsibility | Python dependency on sibling skills |
| --- | --- | --- |
| jsf-search | Discover and assess vacancies | None; workspace profile/config export is an optional agent-level integration |
| jsf-profile | CV-based candidate facts and search preferences | Search criteria, numeric and compensation validation from jsf-search |
| jsf-vacancies | Persistent vacancy observations, identities and review choices | jsf-search identity, criteria and timestamp helpers |
| jsf-application | Candidacy records and hiring progress | Standard CSV CLI has none; tracking helper uses jsf-search canonical URLs |
| jsf-salary | Evidence-based asking ranges and currency conversion | None |
| jsf-workflow | Coordinate lifecycle actions, drafts and cumulative UI views | Search, profile, vacancies and application; Codex is an external dependency |

Explicit reuse of identity/criteria contracts is reasonable. The dependency count alone does not establish bad coupling. Existing domain ownership and the coordinator decision in `docs/adr/0002-coordinate-specialist-skills.md` should be retained unless deliberately changed.

The following findings describe the pre-change implementation; file paths and line references are historical.

### 1. Confirmed import-order dependency

`jsf-profile/scripts/guided_setup.py:78` and `:83` import `evaluate` without ensuring it is available. The UI masks this because `jsf-workflow/scripts/modules.py:6` populates global `sys.path` first. A documented owner helper fails in a fresh Python process even when all sibling directories exist.

Reproduced in the repository's Python environment: import guided_setup using only its own scripts directory, then call accept_config_answers with valid first-stage answers. Result: `ModuleNotFoundError: No module named 'evaluate'`.

### 2. Confirmed module-name collision

The bare `profile` module name conflicts with Python's standard-library module. Preloading the standard-library module then importing workflow fails with `ImportError: cannot import name 'ValidationError' from 'profile'`. Relevant imports: `jsf-workflow/scripts/modules.py:12`, `jsf-profile/scripts/search_config.py:8`, `jsf-profile/scripts/guided_setup.py:9`. Changing sys.path cannot replace an already cached module.

### 3. Coordinator depends on storage structure

`jsf-workflow/scripts/workflow.py:47` onward reads observations, assessments, corrections and application records to build the UI view; `:119` reads history redirects, and `:127` reads profile records/sections directly. Some composition is necessary, but this exposes the coordinator to changes in several owners' storage layouts. Owner query outputs could hide those details without adding skills.

`setup_sessions.py` also uses the profile owner's generic require/encoded/atomic_write helpers to manage workflow-owned drafts and knows profile source/proposal structures. This is additional coupling, though owner-routed canonical writes remain correct.

### 4. Deployment assumes sibling layout

Cross-skill imports build paths from `parents[2]` and insert sibling scripts into global sys.path. Copying a dependent skill folder by itself does not provide its prerequisites. These requirements are partly documented but do not constitute isolated installation boundaries.

## Positive boundaries

- Search does not own cross-run history or application tracking.
- History and candidacy records remain separate concepts/artifacts.
- Canonical writes use owner helpers; workflow owns workflow drafts/reports/uploads rather than competing profile/history/application stores.
- Profile facts and search preferences have separate YAML artifacts under the agreed single setup owner.
- No runtime circular dependency between specialist skills was found in the inspected imports.

## Agreed requirement

Q1: The user confirmed that skills must be callable independently and complete the work they were originally built for. Each specialist must work through its documented entrypoints with valid inputs and declared prerequisites, without the UI or workflow controller initializing it first. Existing responsibilities remain the acceptance baseline. This does not by itself require every folder to be installable without any declared sibling dependency.

## Agreed direction

Define independence as a specialist being callable with valid input and explicitly declared prerequisites, without the workflow controller or unrelated skills being initialized first. Treat a completely copy-installable folder as a separate packaging requirement.

Keep the six responsibilities. First fix reproducible import isolation/name-collision defects; then expose small owner query operations for identities, display facts and usable expertise. Keep the coordinator responsible for composition. Add fresh-process tests at supported entrypoints, so import state from another suite cannot conceal dependencies. Avoid a generic plugin/runtime rewrite or new tiny skills.

## Decisions

Q2: Keep the existing six skill responsibilities and storage contracts while repairing their boundaries. Agreed.

Q3: Permit reuse through small documented owner APIs, with explicit prerequisites and no import-order dependency, instead of duplicating validation/identity logic. Agreed.

## Delivered

- Namespaced each skill's Python implementation while retaining its original CLI entrypoint. Dependencies are resolved by their owning modules and produce an actionable error when absent. Standard-library `profile` and unrelated generic module imports cannot change behavior.
- Added vacancy display/identity query and edit/import interfaces, application record/identity interfaces, and profile export/expertise/context/preview/save interfaces. Workflow composes these owner outputs rather than interpreting history or source-registry containers.
- Preserved existing YAML, CSV and history formats, responsibilities, direct invocation and natural-language triggers. No new skills, shared runtime framework or data migrations.
- Documented supported Python interfaces and sibling prerequisites. Independence is direct usability with declared prerequisites, not dependency-free copying.

## Verification

All six skills pass skill validation. The regression suites cover profile/configuration, search, history, salary, workflow, guided setup, HTTP and application CSV persistence. Nine fresh-process tests additionally copy only selected skills and declared prerequisites, preload standard-library `profile`, poison old generic module names, and exercise direct owner calls and original CLI entrypoints.

An independent forward test used only temporary fictional data: profile/config save/export, assessment/history import, persistent field correction, applied/unapplied edits, discovery excluding already tracked IDs, and fresh CLI calls all passed. Source acquisition, AI interpretation and ECB rates were mocked; this change does not claim a new live-source/provider verification.

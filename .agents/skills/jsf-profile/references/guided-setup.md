# Guided setup contracts

`scripts/jsf_profile/guided_setup.py` exposes Python 3 operations used by `jsf-workflow`'s local dialog. Install the skill's requirements; `ruamel.yaml` preserves comments/quotes while changing user-selected preferences. Existing configurations are first validated with the strict YAML owner loader. Invalid root documents are reported rather than silently replaced.

## Search preferences

- `config_snapshot(workspace)` reads current YAML text, or returns null if absent. No writes.
- `config_questions(original, answers, stage)` returns field descriptors in four groups: role/work, location/eligibility, compensation/technical, and other preferences. Descriptors include stable field ID, label, help, type, options, required/nullable flags and current value. `__FILL_ME__` means an unanswered required choice, not no preference.
- `accept_config_answers(original, previous, stage, answers)` validates current answers and returns accumulated choices. JSON values represent numbers, arrays, explicit nulls, and compensation/FX objects. Optional unknown conversion inputs and automatic budgets use existing defaults, never guessed rates/hours. CV expertise is not silently selected as a mandatory filter.
- `config_plan(original, answers)` returns schema version 1, base revision of original text, proposed YAML text and validated effective criteria. It writes nothing. Required choices and cross-field constraints must pass the existing search evaluator before final review. Untouched preferences and comments are retained.
- `save_config(workspace, proposal)` rechecks the current file revision and proposed contract, then atomically writes `search-config.yml`. Identical retries do nothing. This can save preferences before a profile exists; overall search readiness still requires a usable profile. No search is started.

All form-accessible fields are defined in `GROUPS`. Existing source selection and preference ranking are preserved; new configurations use the documented LinkedIn/default preference behavior. Advanced dated FX input is optional, uses EUR/PLN/USD and is validated through the existing search contract.

## Profile interpretation

Python callers import `from jsf_profile import guided_setup`. `profile_context(workspace)` returns an opaque `profile` snapshot plus `cv_sources` (`id`/`name` entries); pass the snapshot back to owner helpers rather than interpreting its source registry. `select_cv(profile, source_id)` validates and copies a registered CV, rejecting unknown/non-CV IDs. `profile_review(proposal)` returns readable draft Markdown. These are read-only. `source_directory_in_use(workspace, directory)` checks source protection before draft cleanup and conservatively protects existing directories if the active profile cannot be read.

`save_profile(workspace, proposal)` applies the reviewed plan through the owner, rejects stale plans, and can finish README/receipt writes after a partially completed save. It returns the normal persistence result; validation and I/O errors propagate. No workflow initialization is required by these helpers.

`profile_prompt(existing, sources, transcript)` builds a bounded interpretation request with the existing profile contract. Source snapshots come from `profile.extract` or an existing canonical source. `user_source(answers)` builds a source from explicit answers only; question wording cannot become factual evidence. Skipped answers contribute no asserted facts.

The interpreter returns a message, at most six structured text/single/multiple-choice questions, and `changes_json`: a JSON-encoded complete accumulated profile changes input. Python supplies trusted source objects, then `profile_plan` calls the existing pure profile planner. Non-null facts need exact source quotations; explicit corrections require user-statement evidence. Stable IDs, prior facts, conflicts and correction provenance follow the normal profile contract. Optional unknown facts do not block a usable partial profile.

The final profile preview uses the normal readable renderer. Only an explicit Save calls `profile.apply_plan`, which rejects stale revisions. Canonical YAML remains authoritative; draft proposals are not exported profiles or a profile JSON cache. The owner publishes Markdown atomically after supporting evidence; interrupted saves can be retried without reapplying facts.

The profile review dialog accepts direct Markdown edits, including an existing saved profile. `profile.edit_plan` parses the defined Markdown grammar and records only changed claims as explicit user corrections, retaining unchanged evidence. It does not call the interpreter or start a revision questionnaire. Validation errors leave the draft editor and active profile intact. An explicit CV import starts the interpretation flow separately.

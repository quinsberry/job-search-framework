# Skill authoring

Use the existing `skill-creator` when creating or updating skills. These conventions apply to this project's job-search skills.

- Give each skill a useful, cohesive responsibility. Do not create a skill for every helper command.
- Define versioned inputs, outputs, required fields, explicit unknowns, errors and side effects. Use JSON for exchanges between skills and scripts.
- Use YAML for user-maintained configuration and candidate facts; load safely and validate before execution. Markdown is a generated readable view. Preserve existing storage contracts, such as the application CSV, until a migration is explicitly designed.
- Implement scriptable mechanics in Python 3: validation, transformations, comparisons, calculations, persistence, artifact assembly and orchestration. Keep AI interpretation and drafting separate from deterministic business rules; validate their structured results.
- Add `scripts/` for executable helpers and `references/` for schemas or conditional detail when needed. Avoid empty directories and duplicated documentation.
- Describe natural-language use cases in skill descriptions so users do not need explicit skill mentions. Keep implicit invocation enabled for these skills.
- Each persistent artifact has one owning skill. Consumers read it or request updates through the owner's contract; they do not implement competing writers.
- Require an explicit workspace. Distinguish read-only operations from mutations. Use deterministic evaluation and idempotent writes where applicable; declare external observations, timestamps and other changing inputs.
- Keep specialist skills independently usable. The lifecycle coordinator selects and composes their operations without duplicating domain logic or directly editing their data.
- Verify meaningful behavior, especially parsing, money, state preservation and replay. Use the existing skill validation workflow.
- Deliver one skill at a time: settle its contract, implement it, verify it, then move to the next skill. Initial workflows run on demand; scheduling is a later integration using the same entrypoints.
- Commit each completed skill creation and its supporting changes before starting the next skill. Keep one skill creation per commit and leave unrelated changes unstaged.

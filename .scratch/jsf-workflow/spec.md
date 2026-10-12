# Modular job-search workflow

Status: needs-info

## Requested plan

Plan the additional skills needed for comfortable vacancy discovery, monitoring and handling the hiring process. Skills must have focused responsibilities and defined inputs and outputs. Implement scriptable work in Python 3; this execution model is a core requirement, not an optional convenience.

The user explicitly invoked grill-with-docs (grilling and domain-modeling). This is a design interview; no new workflow skills are authorized for implementation before its final shared-understanding confirmation.

## Existing constraints

- `jsf-search` owns discovery and within-search assessment/deduplication. Previous-run history belongs elsewhere, per ADR 0001.
- `jsf-application` owns application records; a record can exist before actual submission.
- `jsf-salary` researches asking ranges, which are separate from advertised compensation and employer offers.
- Preserve the distinction between vacancies, candidacies, search criteria, and evidence-backed vacancy snapshots.
- Keep domain language in root `CONTEXT.md` and consequential decisions in root `docs/adr/`.

## Settled foundations — round 1

- Put reproducible mechanics in Python 3; keep conversation, evidence interpretation and drafting outside deterministic business rules.
- Use an explicitly selected workspace, with one owning skill per persistent artifact. Other skills consume data or request updates through the owner's contract.
- Start with on-demand execution. Scheduling can later invoke the same entrypoints; outbound messages and submissions remain explicit actions.
- Separate changes to vacancy listings from hiring-process tasks and progress. A disappeared posting is not an individual rejection.
- Create only useful, cohesive skill boundaries rather than maximizing the number of skills.

## Settled decisions — round 2

- `jsf-workflow` coordinates the lifecycle from a user goal and workspace, producing next-step plans or completed workflow results. Specialist skills own domain work and persistence.
- `jsf-profile` owns source-backed professional facts from a CV and explicit corrections/additions. Support PDF and Markdown CV input. Produce structured profile data, a readable `candidate/README.md`, and extraction ambiguities. Search preferences and asking compensation remain separate.
- YAML is the editable canonical configuration/profile format; validated JSON is the execution/inter-skill contract. Markdown is generated from canonical facts. Preserve the existing application CSV pending an explicitly designed migration.
- Use the existing skill-creator with project conventions in `docs/agents/skills.md`, linked from `AGENTS.md`, instead of creating another meta-skill.
- Combine vacancy history and change detection in `jsf-vacancies`. Extend `jsf-application` with hiring tasks and due-action queries instead of separate monitoring/reminder skills.
- Work sequentially: settle, implement and verify one skill, then move to the next. Start with `jsf-profile`; defer detailed design and implementation of the other skills.
- Commit each completed skill creation before starting the next; one creation per commit, with its supporting docs and no unrelated changes.

## Interview history: proposals raised by the user

- Add CV intake that produces a readable candidate profile usable by other skills.
- Add a lifecycle coordinator that chooses what to do and which focused skill to invoke.
- Establish shared skill-authoring conventions: Python 3, purposeful references/scripts directories, and natural-language discovery.
- Consider YAML for user-maintained configuration and JSON for inter-skill exchange.

The foundations of these proposals were accepted in round 2; per-skill details are resolved one at a time.

## Current frontier

- `jsf-profile` is implemented and verified; its accepted behavior and checks are recorded in `.scratch/jsf-profile/spec.md`.
- `jsf-vacancies` is implemented: one Python helper owns saved vacancy history, deduplication, changes and explicit review choices. Its settled contract and verification are recorded in `.scratch/jsf-vacancies/spec.md`.
- Other skills' detailed contracts remain deferred under the user's sequential delivery instruction.

Original design branches:

1. Supported lifecycle and stopping boundary.
   - Dependent decisions: additional skill responsibilities, handoffs and roadmap.
2. Python execution versus evidence interpretation and human decisions.
   - Dependent decisions: script contracts, skill entrypoints, deterministic replay.
3. Explicit workspace and ownership of shared state.
   - Dependent decisions: canonical identities, persistence format, history and migrations.
4. Manual versus scheduled execution and external actions.
   - Dependent decisions: monitoring cadence, scheduler integration, notification channels.
5. Meaning of monitoring vacancies versus following hiring progress.
   - Dependent decisions: change detection, follow-up rules, deadlines and outcomes.
6. Common input/output contract conventions.
   - Dependent decisions: versioning, errors, read-only operations and mutations.

## Factual inventory

Read-only inspection of the existing skills and helper contracts found:

- Search returns structured results and snapshots but owns no historical store or recurring monitoring configuration. Its Python adapter registry currently contains LinkedIn only.
- Application owns `applications_table.csv` and candidacy UUIDs; it tracks statuses, planned stages and the next interview. It has no structured follow-up tasks, completed interview history or offered compensation schema. Duplicate checks primarily use stored vacancy URLs, not search aliases.
- Salary returns asking ranges, evidence and confidence in a human-readable answer; its Python helper converts FX. It has no persisted structured result contract.
- No existing local skill owns cross-run vacancy history, change detection, due actions, application preparation, interview preparation/outcomes or structured offer comparison.

These are implementation facts. Proposed additional skill boundaries and names remain open decisions.

## Confirmation

The design interview is in progress. Record vocabulary and decisions when resolved; do not create empty glossary or ADR placeholders.

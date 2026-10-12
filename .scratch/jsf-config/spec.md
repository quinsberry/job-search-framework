# CV-based profile setup and search configuration

Status: resolved

## Request

Create a focused skill accepting a PDF/Markdown CV and explicit workspace path. Produce a user-editable YAML configuration for targeted roles and candidate skills/expertise. Include every agreed field, with actionable fill instructions and commented examples for fields unsupported by the CV. Other skills should consume the configuration through a defined contract. Keep mechanics in Python 3 and commit the completed skill before proceeding to another.

The user invoked grill-with-docs: settle the design through grilling and domain-modeling before confirming implementation.

## Existing facts

- `jsf-profile` owns source-backed professional facts and accepts PDF/Markdown; its canonical YAML and export preserve evidence and conflicts.
- `jsf-search` owns vacancy discovery/assessment. Its JSON criteria distinguish candidate geography, role/seniority preferences, compensation, technical conditions and work arrangements. CV facts alone do not establish desired search filters.
- Search currently uses null as explicit no restriction for some criteria and empty lists as no technical restrictions. Unfilled config values therefore need an unambiguous representation so missing decisions cannot silently weaken search filters.
- Workspace artifact ownership and YAML-to-JSON execution contracts are existing project conventions.

## Settled decisions — round 1

The user agreed to all Q1–Q4 recommendations.

- `jsf-config` owns user-editable search configuration and reuses `jsf-profile` for PDF/Markdown intake and professional facts. Reference the profile rather than duplicate employment/skill history.
- Auto-fill supported CV facts only. Desired titles, levels, compensation, work arrangements and technical requirements are user preferences; suggestions can appear in comments but cannot become active filters without a user choice.
- Use `__FILL_ME__` for unfinished decisions, with comments explaining the field and examples. Preserve the meaning of explicit null/no restriction. Export must reject unresolved required choices before executable search criteria are produced.
- Initial creation provides a template. Reruns preserve edited preferences and comments; identical reruns make no changes. Later CV imports update profile facts through their owner, without automatically replacing search choices.

## Interview history — round 1

1. Responsibility and ownership: configuration versus candidate profile; reusable CV intake versus duplicated parsing/facts.
2. Evidence and intent: auto-fill literal CV facts versus propose desired roles and requirements for confirmation.
3. Missing-field representation: distinguish unfinished decisions from deliberate no restriction; commented examples must not become actual values.
4. Repeat-run policy: preserve user edits and avoid overwriting configured preferences on a later CV import.

## Settled decisions — round 2

The user agreed to all Q5–Q9 recommendations.

- Keep the existing search vocabulary. Configuration includes metadata/profile reference; sources, titles, seniorities and vacancy count; candidate geography/authorization, work arrangements and office locations; compensation minima per contract/currency/period/basis; required/preferred/excluded technical conditions; vacancy-type preferences/exclusions and company exclusions; preference order, posting age and discovery budget; optional hours/dated FX conversion inputs.
- Expertise, experience, projects and languages remain in the referenced candidate profile. Search compensation minima are distinct from application asking ranges.
- Include all agreed fields and instructional/commented examples. Unanswered fields remain marked. Required unresolved choices block export; optional ones block only when relevant to execution. Defaults must be explicitly accepted rather than taken from example values.
- One `<workspace>/search-config.yml` referencing `candidate/profile.yaml`; use different workspaces for different campaigns in the first version.
- A Python helper creates the template, validates/reports missing choices, and exports existing JSON search criteria. Update search instructions to consume that export. Other skills remain readers of the configuration/profile.
- Partial CVs yield supported profile facts plus config placeholders. An unreadable/scanned CV still permits a template, but the profile reference remains unresolved and extraction problems are reported. No claim of complete setup on failed extraction.

## Current frontier

None. The user accepted the exact optional defaults, then changed ownership: extend `jsf-profile` instead of creating `jsf-config`. They explicitly requested removing persisted `profile.json` and confirmed that search preferences stay in separate `search-config.yml`.

## Final implementation

This supersedes the proposed separate-skill ownership above. `jsf-profile` is the sole owner of CV-based setup: professional facts, README, and the search config. Keep facts and preferences in distinct YAML files. No new skill is created.

- Existing `profile.py` CLI adds `init-search`, `validate-search`, `export-search`, backed by a focused internal Python module and maintained commented YAML template.
- Source-backed professional facts stay in `candidate/profile.yaml`. No persistent `candidate/profile.json`; export validates current YAML and emits fresh JSON to stdout. Apply/render remove the legacy generated JSON cache. README remains a derived readable view.
- All agreed search fields are present, including nested candidate/technical/vacancy-type/conversion fields. Required unknowns use `__FILL_ME__`. Optional fallback behavior is documented and reported during validation.
- Optional defaults accepted: LinkedIn; unspecified city; no authorization/office/age filter; empty technical preferences/exclusions, vacancy-type preferences/exclusions and company exclusions; unrestricted required vacancy type; inferred ordering from explicit preferences; effort budget target × 10. Unknown hours/FX remain unknown. Partially completed FX blocks export.
- CV roles and technologies appear as inactive comment examples. Only unambiguous current residence explicitly stated in the source/user input can populate geography; historical employment locations cannot.
- Initial creation can produce a draft without readable profile facts. Export requires supported current profile facts and complete/valid mandatory search choices. Partial supported profile facts are allowed.
- Existing config bytes/comments are preserved on initialization and subsequent CV import. JSON exports are read-only; YAML always owns current data.
- `jsf-search` uses fresh criteria export for workspace-config searches and fresh profile export for expertise, without becoming a config writer.

## Verification

- 25 professional-profile tests and 10 config tests passed, covering current-YAML export, legacy JSON cleanup, source/history preservation, no-op imports, config comments, required placeholders, accepted defaults, incomplete FX, safe YAML, malformed criteria and read-only CLI behavior.
- All 34 search tests and 14 vacancy-history tests passed. Both updated skills passed skill-creator validation; diff whitespace checks passed.
- Independent forward test imported a fresh synthetic CV, created/finalized the search config, exported criteria, imported a shorter second CV, and made an evidence-backed manual profile edit. Earlier professional facts and all config bytes/comments survived. Fresh export and README rendering reflected the manual edit. Only profile YAML, README and search-config YAML were persisted; there was no profile JSON cache or live network access.

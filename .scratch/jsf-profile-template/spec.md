# Explicit candidate profile template

Status: resolved

## Request

Explain why jsf-profile contains search-template.yml and search-config.md, and design an explicit profile-template.md so CVs map into the framework's profile structure.

## Pre-change ownership and implementation

jsf-profile owns candidate facts and separate search-preferences setup by prior agreement. search-template.yml initializes the workspace search-config.yml; search-config.md documents its fields, defaults and validation. Neither is a candidate profile template.

The candidate structure is already fixed in Python FIELDS/EXPECTED and the Markdown renderer, while AI interpretation maps source evidence into records. The current renderer omits empty sections and absent optional fields. There is no separate maintained Markdown template artifact.

## Draft

The agreed draft has moved into the owning skill as [profile-template.md](../../.agents/skills/jsf-profile/references/profile-template.md). It defines the existing seven sections and all supported fields without expanding profile scope. The scratch copy is removed to keep one maintained template.

## Agreed decisions

- Q1: Every profile shows all seven sections in fixed order. Empty sections do not create fictional records. Every field needs an example explaining how to fill it, including list shapes where appropriate.
- Q2: Each actual record shows all defined fields, with Unknown for absent information. Optional unknowns do not produce unnecessary warnings or questions.
- Q3: The approved template belongs inside jsf-profile and drives generated layout. CV interpretation supplies facts, Python validates them, and template/schema consistency must be verified.
- Q4: Examples accompany each field in the skill template and are available as UI help. Saved profiles contain user facts or Unknown, without illustrative candidate content.
- Q5: Links, achievements, technologies and project outcomes use lists. Other fields use text, preserving date precision. Employment, skills, projects, education, languages and certifications use repeatable records.

## Delivery

All five questions were agreed, and the user confirmed implementation with “agree”. The skill template now drives rendering order/labels and help examples. Python validates coverage and example types against the owner schema; newly imported or edited values use defined scalar/list types. Legacy stored values remain readable without invented correction provenance. Optional unknowns do not add warnings. Profiles show all section headings but no fabricated empty records.

Template help is available through an independent CLI/Python operation and the local editor's expandable help. Template comments/examples never enter saved candidate facts. Existing profiles acquire the latest presentation on explicit save; no opening/export rewrite is introduced.

## Verification

157 automated tests plus application CSV checks passed, including template-driven ordering, schema/example drift rejection, all sections/fields for sparse profiles without fabricated records, scalar/list validation, optional unknown readiness, independent CLI help and legacy evidence round-trips. All six skills passed validation, and the updated frontend script passed syntax checking.

Browser checks on a temporary fictional workspace confirmed all seven editor sections and 33 help examples, including indented list syntax. Opening examples left the editor unchanged. An independent forward pass verified sparse CV import, manual edits, rejected type mismatches and legacy YAML-to-Markdown save with preserved facts/evidence and backups. No real candidate data, live AI or source requests were used for tests.

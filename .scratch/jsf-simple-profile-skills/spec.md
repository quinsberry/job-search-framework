# Compact candidate skills

Status: resolved

## Request

The user questions the name/level/context record per skill and proposes a simple list such as React, TypeScript and AWS.

## Current facts

Name identifies the skill, level represents stated proficiency, and context represents usage. Profile readiness currently expects name and level; context is optional. The workflow passes exported skill/experience/project/language records as interpretation context rather than deriving additional mandatory search filters.

## Proposal

Replace verbose per-skill fields in the readable profile with a compact skills list. Leave detailed usage in professional experience/projects and never infer proficiency from a keyword. First settle the visible shape, then decide how to preserve existing explicit level/context information and downstream compatibility. Implementation is authorized by the final agreement.

## Agreed decisions

Q1: Replace per-skill name/level/context blocks with a simple Markdown list of skill names, without visible per-skill IDs or missing-level warnings.

Q2: Render languages as compact list entries, preserving explicitly stated proficiency inline when available. Missing proficiency does not create a warning.

Q3: Render candidate identity as one field block without a repeated name/record heading.

Q4: Supersede the earlier show-all-fields decision for optional unknowns. Omit unknown optional fields from saved profiles, retaining their complete definitions/examples in template/help. Keep all seven section headings and useful expected unknowns.

## Verified consumer behavior

No downstream deterministic rule consumes skill level/context. They are passed to AI as context alongside experience/projects/languages; mandatory technical search conditions come from separate search preferences. Converting the readable shape still requires coordinated parsing, export and evidence compatibility.

## Preservation decision

Keep employment/project records, company/role and date precision where they preserve useful distinctions. Q5: Do not maintain the old structure. Back up the original profile and supporting evidence once before conversion; use only the simplified structure afterward. Retired skill level/context fields are absent from active data and exports. The user confirmed implementation.

## Implementation and verification

Compact Markdown version 2, current schema/export, template examples and UI help now use the agreed shape. Version-1 Markdown and legacy YAML are read-only inputs for one-time conversion, backed up before explicit save. Source snapshots remain unchanged.

Verified 43 profile tests, 111 downstream unit tests, application CSV checks, skill validation and diff whitespace checks. Independent forward testing used fictional CVs and isolated workspaces for standalone CLI import/export, manual compact-list edits and both legacy migrations. Live AI interpretation and browser interaction were not exercised for this change.

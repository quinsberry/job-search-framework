# Editable search configuration

`jsf-profile` owns `<workspace>/search-config.yml`. It has `schema_version: 1`, `profile_ref: candidate/profile.md`, and a `criteria` object using the existing [search contract](../../jsf-search/references/contracts.md). The profile reference holds skills/expertise, experience, projects and languages; the config does not copy that history. Both files are read afresh when exporting.

The maintained [template](search-template.yml) includes every supported field, fill instructions and inactive examples. `__FILL_ME__` means unfinished. Explicit `null` means no restriction where search supports it; `[]` means no technical conditions/preferences/exclusions in supported lists. Do not use examples as actual user choices. Current residence can be populated from an unambiguous CV statement/user input; targeted roles, desired levels, compensation and work arrangements cannot be inferred from past work.

## Fields and readiness

| Fields | Unfilled behavior |
| --- | --- |
| `titles`, `target_count`, `candidate.country`, `seniorities`, `compensation`, `work_arrangements`, `technical.required` | Block export; require a choice or explicit unrestricted value where supported |
| `sources` | LinkedIn |
| `candidate.city` | Unspecified/null |
| `candidate.work_authorization`, `office_locations` | No additional filter/null |
| `technical.preferred`, `technical.excluded` | Empty lists |
| `vacancy_types.required` | Unrestricted/null |
| `vacancy_types.preferred`, `vacancy_types.excluded`, `company_exclusions` | Empty lists |
| `preferences` | Technical preference order followed by vacancy-type preferences |
| `posting_age_days` | No age restriction/null |
| `discovery_budget` | `target_count * 10` |
| `conversions.hours_per_month`, wholly unfinished `conversions.fx` | Unknown/omitted; never invented |

These optional fallbacks were explicitly accepted during design. They are shown in template comments and validation output. Missing optional keys use the same defaults; missing mandatory keys remain errors. Explicit invalid values are not treated as unfinished placeholders.

Compensation contains one minimum per contract type, with currency (PLN/EUR/USD), period (month/year/hour), and basis (`b2b/before_vat`, `uop/gross`). It is a search minimum, not an application's asking range. Office locations describe acceptable offices; country/city describe residence. Required/preferred/excluded vacancy types use product/outsource/outstaff.

FX has date, source, base and rates. A wholly unfinished object is omitted. If any FX value is filled, finish the whole object or remove it; partially filled FX blocks export. Quote dates. Unknown conversions do not block otherwise valid criteria, but conversion-dependent vacancies need clarification in search. No rate freshness is fabricated by this skill.

## Python operations

All operations use `scripts/profile.py`, the existing Python environment with PyYAML/pypdf, and the sibling `jsf-search` criteria validator. The internal `scripts/jsf_profile/search_config.py` module contains config mechanics without duplicating search rules.

- `init-search --workspace ... [--country ...] [--city ...]`: create the template once. CV roles/technologies are inserted as quoted comment examples from undisputed profile facts. Existing config bytes and comments are never rewritten. Invalid existing profile/config is reported rather than replaced. Without a readable profile, template creation is allowed but readiness is partial.
- `validate-search --workspace ...`: read-only JSON result `{schema_version, outcome, path, missing_fields, defaults, errors, profile_status, criteria}`. `outcome` is ready/partial; `criteria` is normalized when complete and valid, otherwise null. Partial professional facts are allowed; missing/empty profile blocks ready status. A valid but unfinished draft returns exit 0 with partial status; malformed files return exit 2.
- `export-search --workspace ...`: read-only normalized search criteria JSON, or exit 2 for an unfinished/invalid setup. Use stdout as a temporary operational JSON input to search. Do not maintain another saved execution cache.

All generated paths are within the explicit workspace. Original CVs cannot overlap profile/README/config output paths. Search-config creation and professional-profile updates are separate writes, not one transaction; report each outcome accurately. Rerunning setup preserves existing config even if a newer CV changes professional facts. Users can edit search YAML directly; exports always validate current values. YAML object tags, duplicate mapping keys, non-JSON values, cycles and invalid search criteria are rejected.

---
name: jsf-vacancies
description: Save job-search results, remember vacancies across searches, show posting changes, and shortlist or dismiss saved vacancies. Use when the user asks to save found jobs, check what changed, avoid previously seen duplicates, or review their saved vacancies. Consume search results; leave discovery and application tracking to their own skills.
---

# Vacancy history

Use `scripts/vacancies.py` with Python 3 and an explicitly selected workspace. It owns only `<workspace>/vacancies/history.json`. It requires the sibling `jsf-search` skill for its existing criteria and identity contract.

Choose the operation from the user's request:

```sh
python3 scripts/vacancies.py import --workspace /chosen/workspace --results /search/results.json
python3 scripts/vacancies.py list --workspace /chosen/workspace
python3 scripts/vacancies.py review --workspace /chosen/workspace --vacancy-id linkedin:123 --state shortlisted --at 2026-10-12T10:00:00+02:00
```

Paths to scripts are relative to this skill directory. `import --dry-run` previews changes without writing. `list --state shortlisted` filters by the user's review choice. Review states are `unreviewed`, `shortlisted`, and `dismissed`; set one only from an explicit user choice. Supply the actual decision timestamp, preserving it on retries.

Import the complete search result, including its raw snapshot, rather than only the returned matches. Summarize new and changed vacancies, assessment changes, uncertain records and any not observed in the same search scope. Give IDs or URLs so the user can select a vacancy. Counts can overlap: a changed vacancy may also be closed or uncertain.

Absence from search does not prove closure. Preserve search coverage and observation times; never refresh timestamps just because a saved result was imported again. Posting changes do not reset review choices. Fit is supplied by search, and shortlist/dismiss choices are separate from application status.

Read [references/contracts.md](references/contracts.md) for inputs, output fields, identity rules and persistence behavior. Run `scripts/test_vacancies.py` to check the helper. No network access or scheduled execution is part of this skill.

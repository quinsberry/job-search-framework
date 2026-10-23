# 01 — Manual arrangement and Expected salary resolutions

Status: resolved
Type: task

Implement [the reviewed design](../spec.md). Keep original search assessments unchanged, store only user corrections, and derive effective results through one pure module in Applications.

## Implementation plan

1. Extend Applications contracts for the optional arrangement override, structured/legacy Expected salary and effective Manual evidence. Preserve legacy workspace data using the existing migration conventions. Keep original search evidence and assessed response data distinct.
2. Implement and test `model/manual-assessment.ts`: arrangement override/reset, deterministic salary qualification from supplied bands, restoration of original criteria and derived outcome. Reuse existing compensation vocabulary; keep dependencies within Applications and shared contracts.
3. Extend list updates to save and validate the new user inputs only. Continue using the list lock and atomic writes; leave original job/match and search memory unchanged.
4. Compose saved preference loading and assessment in the applications route. Read one published salary-band snapshot per load. All assessed responses use the same implementation; malformed preferences surface errors.
5. Add a successful-publication notification to the preferences flow and wire applications-query invalidation in `app/`, including publication during flush. Do not connect feature modules directly or rewrite application rows on preference save.
6. Update the existing edit dialog, form defaults and table projection. Show Manual provenance, explicit arrangement reset and structured Expected salary with legacy preservation. Hide Salary by default. Manual rows retain their existing outcome.
7. Verify the spec's state transitions, persistence/reload behavior, composition refresh and original-data preservation. Run all four web checks and browser checks on fictional/copied data. Update the web README and feature docs to describe implemented behavior.

## Acceptance criteria

- The behavior and required validation in the spec pass.
- Reset and invalid salary resolution restore original assessments exactly.
- Saving preferences does not write to the applications file; every subsequent load uses published preferences.
- Assessment has one implementation, with no AI call or Search runtime dependency.
- The UI never presents contradictory arrangement, criterion provenance, Outcome or Open questions.

## Comments

### Design review follow-up — 2026-10-23

Addresses all three ponytail findings: preserve original assessments, avoid two-file writes when preferences change, and centralize manual assessment in Applications. Implemented as described below.


## Answer

Implemented the reviewed design in `model/manual-assessment.ts`, separate persisted/assessed contracts, the applications route, existing edit dialog and app-level preference-publication wiring. Original `job` and `match` remain unchanged. Existing v2 files and legacy salary strings remain readable; mutations write v3. Salary preferences affect only the derived response, never rewrite the applications file, and never call AI.

Validation: 196 tests pass; typecheck, lint (one existing unused `disabled` warning) and production build pass. Browser checks on a fictional workspace covered legacy text preservation, multiple arrangements, Manual badges, structured salary qualification, a published minimum invalidating salary without changing the application-file checksum, reset/clear, reload, hidden Salary and a 390px edit dialog with scrolling and visible actions. Browser validation exposed raw Zod union errors; the form now shows field-specific messages, with a regression test.

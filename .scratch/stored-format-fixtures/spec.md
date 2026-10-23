# Golden fixtures for stored workspace formats and the criteria digest

Status: ready-for-agent

Source: [architecture review issue 19](../architecture-review/issues/19-stored-format-fixtures.md) and its triage decisions (2026-10-24).

## Problem Statement

As the job seeker using this local tool, my workspace holds my candidate profile, its draft, my search configuration and its draft, my application list, and search memory. These files are written by earlier versions of the app. The architecture review plans several refactors that move or split the schemas reading these files. If one of them reads a file differently, my existing workspace may stop opening, or quietly lose or change data. If one of them changes the criteria digest, every rejected vacancy in search memory counts as judged under different search criteria, so the next search run re-evaluates all of them and I pay for the model calls again.

Today's tests build stored files from inline objects and check the digest only relatively ("same input, same digest"), so a refactor that changes a stored format or the digest for every input can pass the suite.

## Solution

Commit golden fixture files, with fictional data, for every stored format the app currently reads. Tests open each one through the same store the app uses. They assert two things: an older format loads to the same content as the current format, and a current-format file survives a load and an unchanged save without a single byte changing. Pin the criteria digest to a literal value for a fixed input. Any accidental change to a stored format or to the digest then fails a test that names the cost, and a deliberate change shows up in review as an edited fixture or pin.

## User Stories

1. As a job seeker, I want my existing application list to open after an internal refactor, so that I don't lose tracked applications.
2. As a job seeker, I want an application list written in the previous schema version to open with the same applications, statuses and notes, so that upgrading the app never changes my data.
3. As a job seeker, I want my saved candidate profile to open unchanged after a refactor, so that matching keeps using what I entered.
4. As a job seeker, I want my unsaved profile draft to survive a refactor, so that edits I haven't saved yet are still recoverable.
5. As a job seeker, I want my saved search configuration to open unchanged after a refactor, so that searches keep the same criteria.
6. As a job seeker, I want my unsaved search configuration draft to survive a refactor, so that pending changes aren't lost.
7. As a job seeker, I want search memory to keep every inspected vacancy after a refactor, so that known vacancies aren't evaluated again.
8. As a job seeker, I want rejected vacancies to be re-evaluated only when my search criteria actually change, so that I don't pay for model calls caused by a code change.
9. As a job seeker, I want cached CV conversions to stay reusable after a refactor, so that I don't pay to convert the same CV again.
10. As a job seeker, I want opening and saving an unchanged file to leave it byte-identical, so that my workspace doesn't churn and external-change detection doesn't fire for no reason.
11. As the maintainer, I want a failing test when a refactor breaks reading any stored format, so that I catch it before release rather than from a broken workspace.
12. As the maintainer, I want a failing test when the criteria digest changes for a fixed input, so that every digest change is a deliberate decision.
13. As the maintainer, I want the pin's comment to say what a digest change costs, so that whoever updates it understands they are triggering paid re-evaluation.
14. As the maintainer, I want the conversion cache key pin to carry the same cost note, so that the existing pin is just as clear.
15. As the maintainer, I want each fixture to live next to the module that owns the format, so that moving or splitting a module moves its fixtures with it and modules stay independent.
16. As the maintainer, I want each older-version fixture to record the commit whose schema it was reconstructed from, so that I can check the fixture is faithful.
17. As the maintainer, I want fixtures to contain fictional data only, so that no personal data is committed.
18. As the maintainer, I want a deliberate format or digest change to show up as an edited fixture or pin in review, so that reviewers see the user-facing impact.
19. As a future agent refactoring schemas (issues 03, 09, 11, 12), I want these tests in place first, so that I can refactor freely and trust a green suite.
20. As the agent implementing issue 14, I want one clearly marked digest pin to update, so that the intentional change is a single, explained edit.
21. As the maintainer, I want edge cases to stay in the existing focused tests, so that golden fixtures stay small and readable.

## Implementation Decisions

- **Formats covered:**
  - application list, schema versions 2 and 3;
  - candidate profile and its draft;
  - search configuration and its draft;
  - search memory index.

  Version 1 of the application list and the pre-split workspace layout are excluded; the v1 migration is due for removal (issue 34).
- **Location.** Fixtures live per owning module, next to that module's tests, with the same convention as the profile module's existing legacy conversion cache fixture. There is no shared fixture workspace.
- **Content.** Each fixture is one clean, typical file per supported version, with fictional data. Edge cases (truncated last index line, legacy fields missing, interrupted migration) remain in the existing inline tests.
- **Older-version fixtures are reconstructed from the schema in git history.** Each one is rebuilt from the schema as it stood when that version was introduced, including field order and defaults. Each fixture records its source commit, in a sibling note or a field the schema ignores. The note must not change what is being tested.
- **Assertion for older versions.** Loading the version-2 application list through the store yields the same content as loading the committed version-3 fixture.
- **Assertion for current versions.** Load each current-format fixture, then save the unchanged values through the store's public write path. The file must stay byte-identical. If a store has no write path that leaves values unchanged, use the closest public operation that changes nothing. If a writer is shown not to be deterministic, compare parsed content for that one file and say why in the test.
- **Search memory no-op save.** Preparing a run with the same criteria digest the entries were stored under, at a time within the re-evaluation window, must keep every entry and leave the index byte-identical.
- **Criteria digest pin.** A literal expected value for a fixed preference, skill and rules-version input, with a comment stating that changing it re-evaluates every stored rejection at model cost and must be deliberate. Issue 14 changes it once, on purpose.
- **Conversion cache key pin.** Already exists: the legacy conversion cache test asserts a committed literal key and zero interpretations. Add only the cost comment next to that assertion; export nothing new.
- **No new exports and no direct tests of private serializers.** All checks go through the stores' public behaviour and `criteriaDigest`.

## Testing Decisions

- A good test here exercises a store exactly as the app does: open a workspace folder containing the fixture, load it, and save it back. Assert on what a user would see (loaded content) and on what lands on disk (bytes), never on internal parse steps.
- **Seam 1: each module's store public API.** This is the same seam the existing persistence tests use:
  - the application list: open and list, plus a mutation path for writing;
  - the profile repository and the search preferences repository: open, load, edit and publish;
  - search memory: open and prepare.

  There is one seam per owning module, because each module owns its format.
- **Seam 2: `criteriaDigest`.** It already has a relative test; the pin sits beside it.
- **Seam 3: the existing legacy conversion cache test**, reused for the cache-key pin.
- Prior art: the profile and search persistence tests (temporary workspace, real repositories, reopen and assert), the applications migration test (writes an older workspace, opens it, asserts the result), and the conversion test's committed legacy cache fixture.
- Every test copies its fixture into a fresh temporary workspace; committed fixtures are never written to.

## Out of Scope

- Version-1 application list files, the pre-split layout, and removing the v1 migration (issue 34).
- Edge-case fixtures; they stay inline in existing tests.
- Fixtures for conversion cache contents.
- Adding the decision model's identity to the criteria digest (issue 14).
- Any change to stored formats, the digest computation or the cache key computation.
- The schema refactors these fixtures protect (issues 03, 09, 11, 12).

## Further Notes

- Lands in Phase 1 of the architecture review, before 03, 09, 11 and 12.
- The byte-identical round trip has not been tried; a writer might reorder keys or reformat YAML. The fallback to parsed equality is allowed per file, and each use must be justified in the test.

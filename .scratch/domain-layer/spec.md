# Domain layer for search sources, matching and vocabulary

Status: ready-for-agent
Blocked by: [stored-format fixtures](../stored-format-fixtures/spec.md) (architecture review issue 19) and [matching evaluation](../matching-evaluation/spec.md) (issue 01)

Source: [architecture review issue 03](../architecture-review/issues/03-domain-layer-for-sources-and-ai.md) and its triage decisions (2026-10-24).

## Problem Statement

As the maintainer, I can't tell from the folder structure what is generic and what is job-search domain. The shared folder holds the UI kit and HTTP helpers next to the search source adapters, the Outcome rule and the compensation vocabulary. Those domain pieces sit there only because two features need them. Matching lives inside the Search module, but its consumer is the search workflow in Applications, and it reads Search's published criteria schemas. Applications can't share Search's runtime match result schema, so it keeps a narrowed copy that a compile-time equality check keeps in step. The same work location arrangement, pay period and contract type values are declared twice. Every new source, criterion or consumer makes this harder to follow and easier to break.

## Solution

A domain layer beside the shared folder, with three parts:
- **Search sources:** contracts, plus server-only adapters and the registry.
- **Matching:** client-safe contracts, plus a server-only engine.
- **Vocabulary:** contract types, currencies, pay periods and work location arrangements.

Features and the app compose the domain layer. The domain layer never knows about features, and the shared folder goes back to generic code only. Applications and Search use one match result schema. Nothing the job seeker sees or stores changes. Lint enforces the new layering, and ADR 0011 records it.

## User Stories

1. As the maintainer, I want domain code in a folder of its own, so that I can tell job-search concepts from generic utilities at a glance.
2. As the maintainer, I want the shared folder to hold only code that knows nothing about job search, so that its rule ("generic, imports no features") stays true.
3. As the maintainer, I want search sources in the domain layer, so that adding a source happens in one obvious place.
4. As the maintainer, I want search source adapters to stay next to their contracts under a server-only folder, so that the existing server rule keeps scraping code out of the browser bundle.
5. As the maintainer, I want matching in the domain layer, so that the search workflow uses it without depending on the Search module.
6. As the maintainer, I want matching's client-safe contracts separate from its server-only engine, so that client code in Applications can validate match results without importing server code.
7. As the maintainer, I want the Outcome rule next to the match result, so that the one rule turning criterion results into a Match outcome has an obvious home.
8. As the maintainer, I want the domain layer to export both the full match result and the accepted match result, so that "only qualifying vacancies and vacancies needing clarification become applications" is stated once.
9. As the maintainer, I want Applications to stop keeping its own copy of the match result schema, so that the two can't drift apart and no equality check is needed.
10. As the maintainer, I want the published search criteria schemas in the domain layer, so that matching, the criteria digest and the Search editor all read one definition.
11. As the maintainer, I want search configuration drafts and their empty values to stay in the Search module, so that editor recovery doesn't leak into domain code.
12. As the maintainer, I want contract types, currencies, pay periods and work location arrangements declared once, so that a new value can't reach the search criteria without also reaching the source contracts, or the other way round.
13. As the maintainer, I want source contracts to add their own "unknown" value on top of the shared vocabulary, so that unknown advertised compensation stays representable without polluting the job seeker's choices.
14. As the maintainer, I want source contracts to keep accepting any three-letter currency, so that a vacancy advertised in a currency the job seeker can't choose is still recorded.
15. As the maintainer, I want the matching engine to keep the decision model, its identity and the matching rules version, so that everything that decides a Match outcome sits together.
16. As the maintainer, I want the evaluation tool's logic to move with matching, so that it stays next to what it measures.
17. As the maintainer, I want the AI provider adapters to stay in the shared folder, so that ADR 0005's domain-free adapter design is respected.
18. As the maintainer, I want lint to reject any domain import of a feature or app code, including type-only imports, so that the domain layer can't quietly couple to a feature.
19. As the maintainer, I want lint to reject shared code importing the domain layer, so that generic code stays generic.
20. As the maintainer, I want lint to reject one domain part importing another part's server code, so that matching can never reach the LinkedIn adapter.
21. As the maintainer, I want domain parts to be able to import each other's contracts, so that matching can use the job detail contract.
22. As the maintainer, I want features and the app to import the domain layer at runtime, so that they can validate with its schemas.
23. As the maintainer, I want every new lint rule covered by allowed and forbidden cases, so that a config change can't silently switch a rule off.
24. As the maintainer, I want consumers to import from the domain layer directly, with no re-exports left behind, so that each concept has one import path.
25. As a job seeker, I want my application list, search memory, search configuration and profile files left byte-for-byte as they are, so that the refactor costs me nothing.
26. As a job seeker, I want stored rejections not re-judged because of this change, so that it costs no decision model calls.
27. As a job seeker, I want every screen, API response and search run event to behave exactly as before, so that the refactor is invisible to me.
28. As a future contributor, I want an ADR explaining the layer, its parts, its import rules and why AI providers stay shared, so that I don't undo the decision by accident.
29. As a future contributor, I want the README's architecture rules and extension instructions to point at the new locations, so that "adding a source" leads me to the right place.
30. As the maintainer, I want this to land after the stored-format fixtures, the decision model identity and the evaluation tool, so that the safety nets exist and moved files move once.
31. As the maintainer, I want the decision model port split and the clarifying renames to follow this change, so that those files are touched in their final location.

## Implementation Decisions

- **Layer.** A new `domain` layer beside `shared`, `modules` and `app`, with three parts:
  - **Search sources:** contracts at the root; adapters and registry server-only.
  - **Matching:**
    - Client-safe contracts: criterion result, match result, accepted match result, the Outcome rule, and the published search criteria schemas (target position, salary band, settings, search preferences).
    - Server-only engine: structured checks, decision questions, the matcher, the decision model port and client with its identity, the matching rules version, and the evaluation module from issue 01.
  - **Vocabulary:** contract types, currencies, pay periods, work location arrangements.
- **Shared folder.** It keeps only generic code: the UI kit, HTTP helpers, drafts recovery, workspace file helpers, utilities, and the AI provider adapters, which are domain-free under ADR 0005. The loose Outcome rule and compensation files leave it.
- **Search module.** It keeps search configuration drafts, their empty values, persistence, the client session and the editor. It imports the published criteria schemas and the vocabulary from the domain layer and re-exports nothing.
- **Applications module.** It imports the accepted match result schema from the domain layer and builds its stored application schema on it. The mirrored schema and the type-equality check are deleted. The stored shape is identical.
- **Accepted match result.** It is the match result with the outcome limited to match and needs-clarification. It is defined once, in the domain layer.
- **Vocabulary deduplication.** The source contracts derive pay period, contract type and work location arrangement from the vocabulary and add `unknown` where the source contract needs it. Source currency stays any three-letter code. The enumerations have the same values as today.
- **Import rules** (ESLint, built-in restricted-import rules only):
  - the domain layer never imports features or app code, including type-only imports;
  - shared code never imports the domain layer;
  - a domain part may import another part's contracts, never its server-only code;
  - features and the app may import the domain layer at runtime;
  - the existing rule that code outside server-only folders, server entry files, actions and tests imports no server code, Node built-ins or Bun applies inside the domain layer.
- **Unchanged interfaces.** The matcher, the decision model port (including its identity), the criteria digest inputs, the search source contract, API routes, NDJSON events and every stored format keep their shape. Only import paths change.
- **Documentation.**
  - ADR 0011: context, the three parts, the import rules, why the shared folder stays generic, and why AI providers stay in it.
  - The README's architecture rules list the layer and its rules.
  - The README's acquisition, "Adding a source" and Matching sections name the new locations.
  - The glossary doesn't change.
- **Order.** It lands after the stored-format fixtures (issue 19), the decision model identity (issue 14) and the evaluation tool (issue 01). The decision model port/adapter split (issue 10) and the clarifying renames (issue 12) follow it.

## Testing Decisions

- A good test here proves that behaviour and stored bytes did not change, and that the layer rules hold. A pure move adds no tests of internal structure, and no test asserts where a file lives.
- **Seam 1 (existing): the ESLint config test.** It gets allowed and forbidden cases, in the existing table style, for:
  - a domain file importing a feature, both runtime and type-only;
  - a domain file importing app code;
  - a shared file importing the domain layer;
  - a matching file importing a search source contract (allowed) versus a search source server file (forbidden);
  - a feature importing domain contracts at runtime (allowed);
  - a domain contract file importing server code (forbidden).
- **Seam 2 (existing by the time this lands): the stored-format and digest fixtures from issue 19.** They pass unchanged. That covers the application list (including the accepted match result inside it), search memory, the search configuration and the criteria digest.
- **Seam 3 (existing): the current suite.** The matching, search source, LinkedIn, workflow, route and Applications UI tests pass with only import paths edited. No assertions change.
- Typecheck covers the replacement of the mirrored schema, and the build covers client bundles staying free of server code.

## Out of Scope

- Moving the AI provider adapters.
- Any behaviour, API, event or stored-format change.
- Renaming public symbols or modules (issue 12).
- Splitting the decision model port from its client (issue 10).
- Lint rules other than the layer rules above (issue 17).
- Glossary changes.

## Further Notes

- The layer name `domain` is the one issues 17, 20 and 21 use.
- If a fixture from issue 19 fails during the move, the move has changed a stored format. Fix the move. Don't update the fixture.

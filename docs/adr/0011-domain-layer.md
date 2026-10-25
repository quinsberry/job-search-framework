# A domain layer for search sources, matching and vocabulary

The web app gets a fourth layer, `src/domain/`, beside `shared/`, `modules/` and `app/`. It holds the job-search concepts that more than one feature needs. Before it, they sat in `shared/` only because two features used them (search sources, the Outcome rule, compensation values), or inside Search although the search workflow in Applications was their consumer (matching). Applications could not share Search's runtime match result schema, so it kept a narrowed copy held in step by a compile-time equality check, and work arrangement, pay period and contract type values were declared twice.

The layer has three parts:

- **Search sources** (`domain/search-sources/`): the source contracts at the root; adapters and the registry under `server/`.
- **Matching** (`domain/matching/`): client-safe contracts (criterion result, match result, accepted match result, the Outcome rule) and the published search criteria schemas (target position, salary band, settings, search preferences); the engine under `server/` (structured checks, decision questions, the matcher, the decision model port and client with its identity, the matching rules version, and the evaluation module).
- **Vocabulary** (`domain/vocabulary.ts`): contract types, currencies, pay periods and work arrangements, declared once. Source contracts add `unknown` where a source may not say, and keep accepting any three-letter currency, so pay in a currency the job seeker can't choose is still recorded.

The accepted match result (outcome limited to match and needs-clarification) is defined once in matching, and Applications builds its stored application schema on it. Search keeps its configuration drafts, their empty values, persistence, client session and editor, and re-exports nothing from the domain.

ESLint enforces the layering with the built-in restricted-import rule:

- the domain never imports features or `app/`, not even types;
- `shared/` never imports the domain;
- a domain part may import another part's contracts, never its `server/` code, so matching cannot reach the LinkedIn adapter (evaluation capture therefore receives URL resolution and detail fetching from its caller);
- features and `app/` import the domain at runtime;
- the existing rule that only `server/`, server entry files, actions and tests import server code, Node built-ins or Bun applies inside the domain too.

`shared/` stays generic: the UI kit, HTTP helpers, drafts recovery, workspace file helpers, utilities and the AI provider adapters. The adapters stay there because ADR 0005 made them domain-free (instructions, text and a schema in; no job-search vocabulary), which is this layer's own test for generic code.

The two arrangement lists had different orders; the vocabulary keeps Search's (remote, on-site, hybrid), so the decision questions and the preferences editor are unchanged and only the Applications edit dialog lists hybrid and on-site the other way round.

Moving search sources and matching into a feature module was rejected: matching would then depend on that feature, and the Applications workflow would import it only as types or through a mirror again. No stored format, API or event changes with the layer, and no behaviour beyond that order.

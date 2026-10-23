# 03 — Move search sources, AI providers and matching out of `shared/`

Status: needs-triage
Type: task

`web/src/shared/` mixes generic code (UI kit, `http`, `lib`) with domain components: `shared/search-sources/` (scraping adapters and registry) and `shared/ai/` (provider adapters). Matching lives in `modules/search/server/matching/` although its main consumer is the applications workflow, which receives it through dependency injection.

Proposal: introduce a domain layer (for example `src/domain/search-sources`, `src/domain/ai`, `src/domain/matching`) that features may import and that never imports features, and keep `shared/` for generic code only. Extend the ESLint boundary rules accordingly and update the README architecture and extension sections.

Pure move: no behaviour change. Done when the suite, typecheck, lint and build pass and the boundary rules cover the new layer.

## Comments

### Scope extension — 2026-10-23

A responsibility review found matching concepts scattered because they have no home:

- `shared/match-outcome.ts` (the criteria → Outcome rule) is matching domain logic placed in `shared/` so both Search and Applications can use it.
- `shared/compensation.ts` (contract types, currencies, pay periods) is domain vocabulary, not a generic utility.
- `modules/applications/model/contracts.ts` re-declares Search's `MatchResult` as `matchSchema`, kept in step only by a type check in `workflow.ts`, because modules cannot share runtime schemas.

Include these in the move: put the Outcome rule, the match result schema and the compensation vocabulary in the matching (or a small `domain/compensation`) part of the new layer, import the single match result schema from Applications and delete the mirrored `matchSchema` and its type-equality check. Stored `applications.json` and search memory formats must not change.

### Documentation requirement — 2026-10-23

This issue changes the architecture's layering, so record it as ADR 0011 in `docs/adr/` (context, the layer's contents and import rules, and why `shared/` stays generic), following ADRs 0005–0010. Update `CONTEXT.md` for any domain terms whose home or name changes, and the layer description in `web/README.md`'s architecture rules. The final layer name chosen here is what issues 17, 20 and 21 use.

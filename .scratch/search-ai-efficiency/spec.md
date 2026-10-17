# Reduce AI usage during vacancy search

Status: resolved

## Request

Reduce search AI/token consumption, move suitable work into Python 3, and assess TypeSafe Jev 1.13 as an alternative.

## Confirmed implementation facts

The workflow fetches batches of at most five, sends every incoming posting to Codex before excluding previously known identities from the new-match count, and already uses Python for acquisition, evidence validation, monetary comparisons, fit evaluation and persistence. Each interpretation prompt includes the entire jsf-search contracts reference, full incoming records, criteria and exported expertise records including their evidence. There is no explicit per-search AI-call/token budget or extraction reuse in this path.

## External documentation checked

- https://openrouter.ai/typesafe/jev-1.13 — lists USD 0.042 per million input tokens and USD 0 per million output tokens; structured decision model.
- https://docs.typesafe.ai/concepts/system-one — typed decisions/probabilities rather than generated prose; confidence does not guarantee an individual answer is correct.
- https://openrouter.ai/docs/guides/community/jev-tutorial — separate OpenRouter API key/billing and typed-choice/noul/score requests.

Jev could classify or route ambiguity, but is not a drop-in replacement for current free-form evidence-bearing fact/quote extraction. Quality and end-to-end token/cost savings have not been measured. No external model calls were made.

## Initial design frontier

- Python-first conservative extraction/prefilter policy and treatment of ambiguous evidence.
- Reuse of unchanged extraction with explicit content/criteria/extractor invalidation.
- Whether to optimize existing Codex first or introduce separately billed Jev integration now.

The user approved all four decisions below and authorized implementation.

## Agreed decisions

Q1: Python-first extraction and conservative screening. Skip AI for conclusively unsuitable listings using supported facts and the same mandatory evaluation rules. Ambiguous evidence proceeds to interpretation; keywords, title seniority or city labels alone must not establish rejection. Preserve unknown/clarification behavior and source evidence validation.

Q2: Reuse validated facts for unchanged vacancies and reevaluate current criteria in Python; fresh interpretation only for changed or missing required facts.

Q3: Optimize existing calls/prompts first, then evaluate Jev on saved examples before adding separately billed provider integration.

Q4: Configurable per-search AI allowance, usage visibility and explicit shortfall when the allowance is exhausted.

## Implementation

Search owns conservative quote-backed extraction, exact content/semantic/version keys, a compact fact-only annotation contract and offline comparison cases. Vacancy history owns reusable facts, saved atomically with validated results and cleared on removal. Workflow excludes already tracked identities before new interpretation, reuses compatible facts and reevaluates fit through search. Changed known postings without compatible facts retain their previous assessment; semantic monitoring remains a separate operation.

CLI and UI default to five AI batches per search; zero uses scripts/cache without requiring Codex login. Exhaustion reports an explicit shortfall and leaves unresolved listings unsaved for a later search. Usage includes actual calls, scripted/reused/skipped/deferred listings and CLI-reported token counts with reporting coverage. No guessed subscription cost or token savings are shown.

The compact annotation reference is approximately 2,700 characters versus 12,730 for the previous full reference. This is a prompt-component reduction, not measured total-token savings. Full expertise and supporting evidence are no longer sent to vacancy interpretation.

Six fictional offline cases prepare a Jev classification comparison: four scripted decisions, two requiring interpretation, zero incorrect scripted decisions. Saved external predictions can be scored without network access. Jev is not integrated or called; representative quality, live token savings and provider costs remain unmeasured.

## Verification

Automated owner/workflow/HTTP regression suites and independent fictional-workspace forward verification cover allowance exhaustion, zero-AI reuse, salary reevaluation, invalidation, known-record preservation and removal. A temporary browser fixture verifies zero-AI searching without Codex and visible completion/shortfall feedback. No candidate workspace or live AI/network search was used for these checks.

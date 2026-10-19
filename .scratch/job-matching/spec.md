# Job matching

Status: ready-for-agent. Tracked as `issues/01-matcher-decision-model-skill-threshold.md`.

## Objective and scope

Evaluate one acquired vacancy against the job seeker's search preferences and profile skills, returning a labelled outcome with per-criterion evidence. The app passes `match` and `needs-clarification` results on; `no-match` is dropped.

In scope: the matcher, a decision-model client (currently Jev on OpenRouter), an optional `minSkillMatch` preference with its form field, tests and docs. Out of scope, next spec: the search workflow (loop over `SearchRun`, `maxJobsToProcess`/`maxJobsToMatch` budgets, persistence of results, HTTP endpoint, UI). Profile-based role fit beyond skills, alias tables and threshold tuning are deferred.

## Interface

```ts
// modules/search/server/matching/match.ts
matchJob(
  detail: JobDetail,                                   // shared/search-sources/contracts.ts
  criteria: { preferences: SearchPreferences; skills: string[] },
  deps: { model: DecisionModel },
  signal: AbortSignal,
): Promise<MatchResult>;

type CriterionResult = {
  criterion: 'availability' | 'salary' | 'workArrangement' | 'location' | 'role' | 'seniority' | 'positionType' | 'skills';
  result: 'met' | 'failed' | 'unknown';
  evidence: 'structured' | 'model';
  detail: string;                                      // e.g. "salary not advertised", "skills ≈ 40% < 50%"
};
type MatchResult = {
  outcome: 'match' | 'no-match' | 'needs-clarification';
  criteria: CriterionResult[];
  costUsd: number | null;                              // reported model cost; null when the model was not called or reports none
};
```

Outcome: any `failed` → `no-match`; else any `unknown` → `needs-clarification`; else `match`. Criteria that do not apply (no salary bands, no `minSkillMatch`, remote-only arrangements for location) are omitted. Decision-model, transport and input failures reject with `MatchError` (codes `invalid-input | unavailable | rate-limited | timeout | network | invalid-response | cancelled`), defined in the matching folder rather than reusing `SearchSourceError`; a failure is never a `no-match`. Results are strict Zod schemas.

## Module layout (low coupling, high cohesion)

```text
web/src/modules/search/server/matching/
  decision-model.ts                          DecisionModel interface + DecisionModelClient class (current implementation: Jev)
  structured.ts                              pure checks on structured facts, no I/O
  questions.ts                               builds model questions; maps probabilities to results
  match.ts                                   matchJob: structured first, then the decision model, then combine
  *.test.ts
```

- The matcher depends only on the portable `JobDetail` contract, Search's own `SearchPreferences` and `skills: string[]`. It never imports Profile; the future workflow reads profile skills and passes strings.
- All matching code lives in this one folder. Nothing goes into `shared/ai`; the decision model is not an `AIProvider` (no `interpret()` or readiness) and is not user-selectable.
- No file, type or function outside `decision-model.ts` names the vendor. Replacing Jev with another decision model changes only the body of `decision-model.ts` (endpoint, model ID, request/response mapping, `maxInputBytes`); `questions.ts`, `match.ts`, tests and callers stay unchanged. The model is injected, so tests use a fake `DecisionModel`.
- Search acquisition never imports matching.

## Criteria

Structured checks run first. Any structured `failed` returns `no-match` without calling the decision model. The model answers only what structured data cannot.

| Criterion | Structured (when data exists) | Decision model (otherwise) |
| --- | --- | --- |
| Availability | `closed` → failed; `open`/`unknown` → criterion omitted | — |
| Salary (only with bands) | Any advertised entry with the same contract type, currency and period whose top of range (`max ?? min`) ≥ that band's baseline → met; comparable entries all below → failed; none comparable or none advertised → unknown | — never inferred from text |
| Work arrangement | `advertisedFacts.workArrangements` intersects preferences → met, else failed | `choice`: remote / hybrid / on-site / unknown |
| Location (hybrid/on-site jobs only) | Job location `city`/`country` equals residence (case-insensitive) → met; a different value is not a failure and goes to the model | `yes-no`: is the job located in [city, country]? No commute judgement (see **Search configuration** in `CONTEXT.md`) |
| Role | — | `yes-no`: does this role fit one of [positionTitles]? |
| Seniority | — | `choice` among all seniorities + unknown |
| Position type | — | `choice` among position types + unknown |
| Skills (only with `minSkillMatch`) | Structured must-have skills: coverage = must-haves the candidate has ÷ must-haves; ≥ threshold → met, else failed | `scale`: share of required skills a candidate with [skills] has, 0–100; band per below |

Target salary is never a requirement. No currency or period conversion.

The job's arrangement may only be known from the model in the same request, so include the location question whenever the candidate accepts hybrid or on-site and the job's arrangement is not structured; drop its answer if the job resolves to remote-only.

Skill names compare after lowercasing and removing non-alphanumerics (`Node.js` = `nodejs`). Nice-to-have skills never count. `shortcut: no alias table (k8s ≠ Kubernetes), add one when misses show up in real results.` LinkedIn always supplies `skills: null`, so it uses the model. Sources with structured skills must distinguish must-have from nice-to-have; until the source contract carries that distinction, treat a structured list as must-have.

## Decision model

```ts
// modules/search/server/matching/decision-model.ts
type Question =
  | { type: 'yes-no'; text: string }                  // → probability of yes
  | { type: 'choice'; text: string; options: string[] } // → probability per option
  | { type: 'scale'; text: string; min: 0; max: 100 };  // → expected value
type Answer = { probability: number } | { probabilities: Record<string, number> } | { value: number };
type DecisionRequest = { context: string; questions: Record<string, Question> };
type DecisionResponse = { answers: Record<string, Answer>; costUsd: number | null };
interface DecisionModel {
  readonly maxInputBytes: number;                      // UTF-8 budget for context + question text
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
}
class DecisionModelClient implements DecisionModel {  // production implementation
  readonly maxInputBytes: number;
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
}
```

Question types are named for what they ask, not for one vendor's primitives. A model that cannot return probabilities may answer 0/1; the bands still apply.

Current implementation: Jev via OpenRouter `POST https://openrouter.ai/api/v1/systemone`, pinned model `typesafe/jev-1.14`, key from `OPENROUTER_API_KEY`, mapping `yes-no`/`choice`/`scale` to Jev's `noul`/`choice`/`score`. Verify exact request and response shapes against the [Jev docs](https://openrouter.ai/docs/guides/community/jev) during implementation; validate responses with Zod (`invalid-response` otherwise). Jev's `maxInputBytes` is 32 KB minus a margin for request envelope overhead.

- One request per job carrying all needed questions, so the job text is paid for once.
- Probability bands (fixed constants): p ≥ 0.8 → met, p ≤ 0.2 → failed, otherwise unknown. For `yes-no`, p is the yes probability. For `choice`, p is the summed probability of the options the candidate accepts, so a "remote or hybrid" or "mid/senior" job is not split into uncertainty. For the skills `scale` question: expected coverage ≥ `min(threshold + 10, 100)` → met, ≤ `max(threshold − 10, 0)` → failed, otherwise unknown.
- **Input never exceeds `model.maxInputBytes`, measured in UTF-8 bytes** (for Jev, its 32 KB accuracy/latency limit). Build the context and questions without the description, then fit a truncated description into the remaining budget with a safety margin. If the request without the description already exceeds the budget (very long titles or skill lists), reject with `invalid-input` instead of sending it. Truncation can only produce `unknown`, never a false match.
- The implementation uses bounded retries like the LinkedIn adapter: at most 3 attempts, honour `Retry-After` up to a short cap, respect the caller's signal for timeout/cancellation. Missing credentials → `unavailable` before any request.

## Preferences change

Add optional `settings.minSkillMatch` (integer 1–100, percent) to `searchPreferencesSchema`, its draft text field to `preferencesDraftSchema`, and an input to the Search Preferences form. Existing saved `config.yaml` without the field stays valid; empty means skills are not checked. When it is set and the profile has no skills, the future workflow refuses to start with "Add skills to your profile or clear the skill match threshold"; `matchJob` itself rejects with `invalid-input` for an empty skill list in that case.

## Required checks

- Each criterion yields met/failed/unknown from fictional `JobDetail` fixtures; omitted criteria do not appear.
- A structured failure returns `no-match` and the fake decision model is never called.
- Band edges (0.2, 0.8) map correctly; a `choice` split across two accepted options (0.5/0.5) is met; scale bands clamp at thresholds 95 and 5.
- Location: a structured different city goes to the model rather than failing; the location answer is dropped when the job resolves to remote-only.
- Structured skill coverage: normalisation, nice-to-have excluded, threshold boundary.
- Salary: matching/non-matching contract type, currency, period; `min`-only and `max`-only ranges; no bands → criterion omitted.
- A 200 KB description produces a request body under 32 KB in UTF-8 bytes, including multi-byte text; oversized titles/skills without a description reject with `invalid-input`.
- Missing credentials, model HTTP errors, retries, `Retry-After` cap, cancellation and malformed responses surface as `MatchError` with the matching code.
- `minSkillMatch` validates 1–100, round-trips through draft and save, and old configs load.
- No live network calls in tests. An optional manual smoke script may call the production decision model (Jev, `OPENROUTER_API_KEY`) and must report its cost.

## Docs

- ADR 0008: matching design (structured first, a swappable decision model for the rest — currently Jev, probability bands, preferences + profile skills, outcome rules).
- `CONTEXT.md`: add **Skill match** (share of a vacancy's must-have skills the candidate has, compared to the job seeker's threshold) and **Match outcome** (match, no-match or needs-clarification; failures to evaluate are errors, not outcomes).
- `web/README.md`: a short Matching section — entry point, how to swap the decision model (edit only `decision-model.ts`), the current Jev setup (`OPENROUTER_API_KEY`), the input byte budget, and that results are never inferred from salary text.

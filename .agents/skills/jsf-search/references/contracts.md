# Search contracts

## Criteria

Required keys: `sources`, `titles`, `target_count`, `candidate.country`, `seniorities`, `compensation`, `technical`, `work_arrangements`. A supplied value of `null` is an explicit no restriction for seniorities, compensation and work arrangements. Use empty lists within `technical` to express no technical restriction. `titles` and `sources` cannot be empty.

```json
{
  "sources": ["linkedin"],
  "titles": ["frontend engineer", "software engineer"],
  "target_count": 10,
  "candidate": {"country": "poland", "city": "warsaw", "work_authorization": null},
  "seniorities": ["middle", "senior"],
  "work_arrangements": ["remote", "hybrid"],
  "office_locations": ["warsaw, poland"],
  "compensation": [
    {"contract": "b2b", "minimum": 25000, "currency": "PLN", "period": "month", "basis": "before_vat"},
    {"contract": "uop", "minimum": 20000, "currency": "PLN", "period": "month", "basis": "gross"}
  ],
  "technical": {"required": ["react", "typescript"], "preferred": ["next.js"], "excluded": ["primarily java"]},
  "vacancy_types": {"required": null, "preferred": ["product"], "excluded": []},
  "company_exclusions": [],
  "preferences": ["next.js", "vacancy_type:product"],
  "posting_age_days": null,
  "discovery_budget": 100,
  "conversions": {}
}
```

Optional defaults: budget = target × 10; posting age unrestricted; office locations unrestricted; no company or vacancy-type exclusions. Default preference order is technical preferences followed by preferred vacancy types. `preferences`, when supplied, is the complete ordering; it can include additional named soft criteria (for example `small product team`) backed by observations.

Country, city, location and criterion names are normalized for case and whitespace, not translated or geocoded. Canonicalize facts to the same country names and `city, country` labels used in criteria. An accepted office must be supported by evidence; an accepted fully remote option does not require office matching.

`candidate.work_authorization` is `null` when no authorization filter was requested, otherwise a list of permissions the candidate holds. `facts.authorization_requirements` lists required employer permissions; an evidence-backed empty list means explicitly no requirements. Do not infer an empty list from silence. If sponsorship changes eligibility, resolve its meaning during interpretation before populating this fact.

Optional conversions:

```json
{
  "hours_per_month": 160,
  "fx": {
    "date": "2026-10-09",
    "source": "https://example.com/dated-rates",
    "base": "EUR",
    "rates": {"EUR": 1, "PLN": 4.3, "USD": 1.1}
  }
}
```

These are illustrative values, not market rates. Rates are units of each currency per one unit of the base currency. Annual fixed cash / 12 produces monthly pay. Hourly pay × supplied hours/month produces monthly pay. Same-currency, same-period comparisons need no FX or hours. Missing conversion inputs produce clarification, not invented defaults. Contract minima use `b2b/before_vat` and `uop/gross`; other bases must be clarified, never tax-converted.

## Vacancy snapshot and observations

`schema_version` is 1. `observed_at` is an ISO timestamp with timezone. `vacancies` contains raw records with `source`, a stable `source_id` when available, `url`, `title`, `company`, `location`, `posted_at`, full `description`, `fetch_status` and nullable `active`. LinkedIn records can include `seniority_label` and `employment_type`. The adapter leaves `facts` empty for the agent to interpret.

`interpreted_for` stores normalized criteria after interpretation. `acquisition_criteria`, `acquisition` and `coverage` are current-run checkpoint state, maintained by acquisition. Preserve them verbatim when annotating facts. Imported offline snapshots do not need acquisition cursors. A snapshot interpreted for different criteria must be explicitly reinterpreted before evaluation.

Each fact observation has `value`, `evidence` and optionally an explanatory `reason`. Omitted/null values or empty evidence are unknown. Non-null facts need at least one quotation. Evidence entries are `{ "field": "description", "quote": "exact text" }`; allowed raw fields are description, title, company, location, seniority_label and employment_type. Whitespace and case are normalized when verifying quotations. An invented or mismatched quotation is a validation error.

Example raw description and facts for one fictional posting:

```json
{
  "source": "linkedin",
  "source_id": "1234567890",
  "url": "https://www.linkedin.com/jobs/view/1234567890",
  "title": "Senior Frontend Engineer",
  "company": "Example Company",
  "location": "Poland",
  "posted_at": "2026-10-09",
  "fetch_status": "ok",
  "active": null,
  "description": "Senior frontend engineer building React and TypeScript interfaces. Next.js experience is preferred. Fully remote from Poland. B2B: 25000-30000 PLN per month before VAT. We build our own product.",
  "facts": {
    "role_titles": {"value": ["frontend engineer", "software engineer"], "evidence": [{"field": "description", "quote": "frontend engineer building React and TypeScript interfaces"}]},
    "seniority": {"value": "senior", "evidence": [{"field": "description", "quote": "Senior frontend engineer building React and TypeScript interfaces"}]},
    "work_arrangements": {"value": ["remote"], "evidence": [{"field": "description", "quote": "Fully remote from Poland"}]},
    "eligible_countries": {"value": ["poland"], "evidence": [{"field": "description", "quote": "Fully remote from Poland"}]},
    "vacancy_type": {"value": "product", "evidence": [{"field": "description", "quote": "We build our own product"}]},
    "technical": {
      "react": {"value": true, "evidence": [{"field": "description", "quote": "building React and TypeScript interfaces"}]},
      "typescript": {"value": true, "evidence": [{"field": "description", "quote": "building React and TypeScript interfaces"}]},
      "next.js": {"value": true, "evidence": [{"field": "description", "quote": "Next.js experience is preferred"}]}
    },
    "compensation": [{"contract": "b2b", "low": 25000, "high": 30000, "currency": "PLN", "period": "month", "basis": "before_vat", "evidence": [{"field": "description", "quote": "B2B: 25000-30000 PLN per month before VAT"}]}]
  }
}
```

Supported observations:

| Fact | Value |
| --- | --- |
| `role_titles` | List of configured canonical roles supported by described scope. Map supported equivalents onto requested names; never map another profession based on a technology keyword alone. |
| `seniority` | Canonical level, or list when several levels are explicitly offered |
| `work_arrangements` | List of remote/hybrid/onsite |
| `eligible_countries` | Canonical country list; `["*"]` only for explicit worldwide eligibility |
| `office_locations` | Canonical acceptable office labels |
| `authorization_requirements` | List of required permissions |
| `vacancy_type` | product/outsource/outstaff |
| `contract_types` | Explicitly offered contract types, if known exhaustively |
| `technical.<criterion>` | Boolean establishing whether the contextual technical criterion holds |
| `preferences.<criterion>` | Boolean for additional named soft criteria |
| `compensation` | List of complete advertised bands with evidence; use low = high for a fixed amount |

Technical `false` means a confirmed failure for a required criterion or confirmed absence of an excluded condition; silence is unknown. An exclusion triggers only on confirmed `true`. A preference can be satisfied by an explicit preference mention even when that mention cannot satisfy a mandatory skill criterion; interpret according to the category and context.

If `contract_types` is not known exhaustively, omit it. A known advertised band below one minimum does not disprove another acceptable contract with undisclosed pay. Clarify unknown options; any confirmed acceptable contract reaching its own minimum can pass.

Closed records are rejected. Missing mandatory evidence is clarification. A confirmed failure takes precedence over other unknowns. Conflicting duplicate evidence becomes clarification for the affected criteria; independent confirmed failures still reject the opening. Unknown activity alone is a warning.

## Identity and adapter contract

Primary identity is `(source, source_id)`, falling back to source plus canonical URL. LinkedIn URLs use their numeric job ID, independent of hostname, slug and tracking. Application URLs preserve requisition query parameters and remove tracking only. Cross-source identity requires a shared application URL or `(employer_id, requisition_id)`; a requisition ID without an employer identity is insufficient. Company/title resemblance does not merge records.

Result `aliases` and `provenance` preserve known identities. Duplicate records with complementary evidence can contribute to one assessment; `source_assessments` and the raw snapshot preserve their evidence. Current-run source cursors prevent refetching cards across batches, but no previous-run history is consulted.

To add a source, create a Python adapter and register its factory in `search.ADAPTERS`. The factory accepts `delay`; adapters expose:

- `page_size`: numeric pagination increment.
- `queries(normalized_criteria)`: ordered query dictionaries for the source.
- `page(query, offset)`: a list of raw candidates; empty means exhausted. Preserve source IDs. Raise an error on access failure or unrecognized nonempty result markup.
- `detail(candidate)`: raw details in the snapshot contract, or explicit per-item fetch failure. Never apply or send messages.

Acquisition schedules queries round-robin, preserves unprocessed cards and source errors, and stops repeated page signatures instead of imposing an arbitrary candidate ceiling. Unsupported adapters fail before network access. A LinkedIn MCP adapter can implement this same contract when a suitable tool exists.

Python callers can pass `acquire(..., stop_at_target=False)` when a coordinator owns an additional target such as N previously unseen matches. This continues within the supplied discovery budget and source coverage; it does not read history or change fit evaluation. The standalone default remains stopping at the current-search qualifying target.

## Output

Results contain normalized `criteria`, ranked `matches` capped at the target, separate `needs_clarification` and `rejected` lists, `coverage`, and the full `snapshot`. The additive `assessments` list retains all assessed groups, including qualifying overflow beyond the target, for history consumers. Each assessed vacancy includes facts/evidence, per-criterion checks, compensation comparisons, preference satisfaction, warnings, aliases and provenance.

LinkedIn's explicit closure banner sets `active: false` and records `closure_evidence` (`kind: closed_banner`, exact `quote`). HTTP 404 sets `fetch_status: not_found`, `active: null` and `availability_reason: http_404`; it means an unavailable URL, not confirmed closure. Evaluation also recognizes legacy `not_found` records with `active: false` as uncertain availability.

Preference ranking is lexicographic in the user's ordering: satisfying the first preference outranks satisfying only later preferences. Tie-break by posting date descending, then stable ID ascending. Unknown posting dates sort last. This is not a probabilistic fit score.

`coverage` reports source errors, unique inspected count, qualifying count, returned count, clarification/rejection counts, skipped duplicates, shortfall and stopping reason. An acquisition batch ending is a checkpoint, not final search exhaustion. Continue while `stopping_reason` is `batch_complete` and the target remains unmet.

No source failure erases earlier results. `failed` means acquisition errors left no usable descriptions; `partial` means the target was not reached; `target_met` means enough qualifying openings were found. Input errors are validation failures rather than a search outcome.

Role-scope comparison ignores recognized leading seniority words (junior/jr, middle/mid, senior/sr, staff, lead, principal) on either side, then compares the remaining canonical role names exactly. This is not substring matching. Seniority, compensation, technical and office restrictions remain separate mandatory checks. A generic Frontend Engineer can satisfy Senior Frontend Engineer role scope; explicit junior responsibilities still fail middle/senior filters, and unknown required evidence stays clarification. Compensation must meet its configured criterion independently. Office eligibility uses configured office_locations; do not infer acceptable commuting cities from residence.

## Python-first extraction and reuse identity

`extraction.prepare(criteria, record, observed_at)` returns `{schema_version: 1, facts, needs_ai, cacheable}` without writes, AI or network. Explicit description labels (Role, Seniority, Work arrangement, Eligible countries, Office locations, Required skills) and complete unambiguous pay-band lines produce quote-backed facts. Other prose requires interpretation before a script-derived verdict is final. Raw confirmed closure, explicit posting age and exact excluded company can conclusively reject through the existing evaluator independently. Unreadable descriptions skip AI but remain unknown. Missing salary, a junior title alone, a city label and absent technology words never establish failure.

`extraction.cache_key(criteria, record, interpreter_version)` hashes relevant raw evidence fields, semantic criteria, parser revision and interpreter version. Count/budget, pay thresholds and comparison-only conversion/age/company settings do not require reinterpreting complete facts; final evaluation always runs again. New required facts, changed evidence or extractor/model/contract signature invalidate reuse. Only complete scripted facts or validated AI annotations are reusable; partial facts from a cheap early rejection must not suppress later interpretation.

Annotation-only instructions live in annotation-contract.md. Interpreter input omits candidate profile provenance and unrelated acquisition/history schemas; explicit search criteria remain authoritative. Exact quotations and ordinary fit validators remain required.

For offline comparison run `python3 scripts/benchmark_extraction.py`. It reports scripted decisions, abstentions and disagreements on the saved fictional cases. `--jev-requests` prints request bodies for typesafe/jev-1.13; it never sends them. `--predictions file.json` scores saved `{case_id: match|rejected|needs_clarification}` verdicts. These six examples are regression cases, not a representative quality/cost benchmark; no Jev accuracy advantage is established. Classification alone does not replace the evidence-extraction contract.

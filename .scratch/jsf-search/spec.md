# JSF Search

Status: ready-for-agent
Implementation: complete

## Scope and confirmation

The user confirmed the completed design and implementation on 2026-10-10. Implement the skill at `.agents/skills/jsf-search/`; all helpers, adapters and tests use Python 3.

Search owns vacancy discovery, current-search deduplication, evidence-backed assessment and ranking. Salary research, application tracking, outbound actions and previous-run history belong to other skills. Search does not read previous results or accept cross-run exclusions. It retains stable identities and provenance for a separate history skill.

Plain-language requests such as “find me a job” or “find vacancies” should select the skill without an explicit `$jsf-search` mention. Its discovery description includes these triggers, and `agents/openai.yaml` explicitly enables implicit invocation. Extract existing criteria and ask for missing required choices before acquiring listings.

## Inputs

Required inputs are sources, position titles, qualifying target count, candidate country, and explicit seniority, compensation, technical and work location choices. Accept explicit no restriction where applicable; ask only for missing information. Validate invalid or contradictory inputs before network access.

- Sources are pluggable; LinkedIn public URL acquisition is implemented first. A capable LinkedIn MCP adapter can be added behind the same snapshot contract.
- Multiple titles, seniorities and work location arrangements are alternatives within their categories. All mandatory criteria must pass.
- Candidate geography, acceptable office locations and work-authorization constraints govern location eligibility, including employer restrictions on remote work.
- Technical criteria distinguish mandatory requirements, ordered preferences and exclusions. Assess contextual use and requirements, not keyword presence; recognize equivalent terminology.
- Compensation minima are separate per B2B/UoP contract, in EUR/PLN/USD per month/year/hour, with before-VAT contractor or gross employment basis explicit.
- Optional inputs include company exclusions, required/preferred/excluded vacancy types (Product/Outsource/Outstaff), posting age, discovery budget and dated conversion inputs.
- Default discovery budget is target count × 10, with no fixed 500-candidate ceiling. Posting age is unrestricted by default.

See `.agents/skills/jsf-search/references/contracts.md` for the maintained schema and examples.

## Assessment rules

- Qualifying count means confirmed matches, not inspected listings. Unknown and rejected vacancies consume inspection effort; duplicates do not meet the target.
- Confirmed mandatory failures or exclusions reject a vacancy. Missing mandatory evidence needs clarification; independent known failures take precedence.
- Role scope and seniority use description evidence rather than the title alone. Inaccessible descriptions cannot establish a confirmed match.
- At least one acceptable contract's advertised maximum must reach that contract's minimum. Flag a lower endpoint below the minimum. Undisclosed pay remains unknown; never substitute a market salary estimate.
- Record dated, sourced FX inputs. Annual fixed cash / 12 yields monthly pay; hourly conversions need supplied hours. Do not infer taxes, VAT, bonuses, equity or B2B/UoP equivalence.
- Exclude confirmed closed postings. Unknown activity is flagged but does not alone disqualify an accessible posting.
- Rank lexicographically by user-ordered preferences, then posting recency, then stable identity; no opaque percentage score.
- Deduplicate by source and stable job ID, falling back to canonical URL. Cross-source merging requires a shared application URL or employer-scoped requisition ID, not company/title resemblance.
- Preserve source provenance and conflicting evidence. Conflicting duplicate assessments need clarification for affected criteria.

## Purity and persistence

Acquisition and free-text interpretation are outside pure evaluation. Snapshots contain structured facts and supporting exact quotations. Replay uses the saved facts, criteria, observation time and conversion inputs without fetching, reinterpreting, reading history or consulting the current clock.

Identical snapshot evaluation yields identical results and does not mutate inputs. Live requests can return different or previously seen vacancies. Changed criteria require explicit reinterpretation of criteria-dependent facts.

Helpers return JSON to stdout by default. Save criteria, snapshot, results and a readable shortlist only in an explicitly supplied output directory. Current-search acquisition checkpoints retain query cursors and pending cards; they are not a history archive. Fixed output names support repeatable writes.

## Output and stopping

JSON contains normalized criteria, ranked matches up to the target, separate clarification and rejection results, coverage and the full snapshot. Results include facts/evidence, checks, advertised compensation, preference satisfaction, warnings, aliases and provenance.

Stop on target completion, discovery-budget exhaustion, source exhaustion or failure. Batch completion is a resumable checkpoint. Partial source failures preserve already obtained results. Explain source errors, inspected count, skipped duplicates, stopping reason and shortfall; never relax criteria silently.

Outcomes are `target_met`, `partial` and `failed`. Invalid inputs are separate validation errors before acquisition.

## Reference implementation evidence

Read-only inspection of `/Users/eugene/dev/sandbox/Job-apply-pipeline/code` found guest LinkedIn search, description extraction, within-call URL deduplication, live retries and JSON CLI output. It did not implement compensation/technical fit, multiple-title orchestration, a pluggable source interface or a quota after fit filtering. Its JavaScript is behavioral evidence, not a runtime dependency.

## Implementation and verification

- Added the skill entrypoint, maintained contracts reference, pure evaluator, LinkedIn adapter and explicit validate/acquire/evaluate CLI.
- All helpers use Python 3's standard library; source queries run round-robin with preserved pending cards, paced requests, bounded retries and repeated-page detection.
- Added 31 tests covering replay purity, compensation and conversions, unknown versus failed evidence, eligibility, preference ranking, current-run/cross-source identity, source failures, checkpoint continuation, parser behavior and explicit artifact writes.
- All 31 tests passed. The skill-creator validator passed using PyYAML in an isolated temporary validation environment; the skill itself has no third-party runtime dependency.
- Live read-only smoke check parsed 10 LinkedIn cards and fetched one full description (2,917 characters) with a stable job ID.
- Independent offline forward testing produced a match, compensation clarification and technical rejection as expected; saved-snapshot replay produced byte-identical JSON. Its validation/normalization usability finding was addressed with a dedicated `validate` command.
- `git diff --check` passed. Python bytecode is ignored; operational test artifacts remain outside the repository.

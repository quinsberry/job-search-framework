# Re-judge rejected vacancies when the decision model changes

Status: ready-for-agent
Blocked by: [stored-format fixtures](../stored-format-fixtures/spec.md) (architecture review issue 19)

Source: [architecture review issue 14](../architecture-review/issues/14-decision-model-identity-in-criteria-digest.md) and its triage decisions (2026-10-24).

## Problem Statement

As a job seeker, I rely on search memory to skip vacancies the search workflow has already evaluated. A rejected inspected vacancy is evaluated again only when my search criteria or the matching rules change, or after 60 days. The decision model, the AI that answers matching questions structured checks cannot settle, is not part of that. If the decision model is replaced, or its input budget, question encoding or score mapping changes, rejections judged by the old model stay in search memory. Those vacancies are never judged by the new model, unless the developer also remembers to bump the matching rules version, which nothing enforces. A better model could find matches the old one rejected, and I would never see them.

## Solution

The decision model declares a readable identity that changes whenever anything affecting how it judges changes: the model itself, its input budget, or how questions and scores are encoded. That identity becomes part of the digest stored with every rejection. After a decision model change, the next search run treats earlier rejections as judged under a different basis and evaluates them again, while accepted vacancies and my applications stay untouched. The matching rules version keeps covering matching only. The one-off cost of re-judging existing rejections when this ships is accepted and documented.

## User Stories

1. As a job seeker, I want rejected vacancies evaluated again after the decision model changes, so that a better model can find matches the old one missed.
2. As a job seeker, I want accepted vacancies never re-evaluated because of a model change, so that my applications and their statuses stay as they are.
3. As a job seeker, I want deleted applications to stay deleted after a model change, so that the search doesn't bring them back.
4. As a job seeker, I want rejections kept when nothing about the judging changed, so that I don't pay for the same evaluations twice.
5. As a job seeker, I want a change to the model's input budget to count as a model change, so that vacancies previously judged on a truncated description get a fair re-evaluation.
6. As a job seeker, I want a change to how questions or scores are encoded to count as a model change, so that outcomes from the old encoding don't linger.
7. As a job seeker, I want to know that the first run after this ships re-evaluates my stored rejections once, so that the cost of that run is not a surprise.
8. As a job seeker, I want the 60-day re-evaluation of rejections to keep working as before, so that stale rejections still expire.
9. As a job seeker, I want changes to my search criteria to keep triggering re-evaluation as before, so that nothing I rely on regresses.
10. As a job seeker, I want reruns to keep skipping known vacancies without fetching details, so that runs stay fast and cheap.
11. As a maintainer replacing the decision model, I want re-evaluation to follow automatically from the model change, so that I can't forget a manual version bump.
12. As a maintainer, I want the model ID defined once, so that the model requested and the model recorded in the identity cannot drift apart.
13. As a maintainer, I want a format version next to the client's question encoding and score mapping, so that I bump the version right where I change the code.
14. As a maintainer, I want the matching rules version to cover matching rules only, so that each version lives with the code it covers.
15. As a maintainer, I want the README to say which version to bump for which change, so that the rule is clear without reading the code.
16. As a maintainer, I want the identity to be readable, so that test failures and digests can be traced to a concrete model and settings.
17. As a maintainer, I want the criteria digest to receive the identity as an input rather than importing a concrete client, so that matching stays independent of any one model adapter.
18. As a maintainer, I want the composition root to be the only place that connects the model's identity to the digest, so that wiring is obvious and enforced by the type checker.
19. As a test author, I want fake decision models to declare a fixed identity, so that tests are deterministic.
20. As a maintainer, I want the pinned criteria digest updated once with an explanation, so that the deliberate change is visible in review.
21. As a maintainer, I want ADR 0009 amended to say the digest includes the decision model's identity and why, so that future readers know re-judging on model change is intended.
22. As an agent adding a second decision model later, I want the identity to be part of the port contract, so that the new model gets correct re-evaluation behaviour without extra work.

## Implementation Decisions

- **Domain language.** **Inspected vacancy** now says rejections are evaluated again after the search criteria, the matching rules or the decision model change, or after 60 days. **Decision model** is a glossary term. The glossary is already updated.
- **Port contract.** The decision model port gains a read-only `identity` string next to its input budget and its decide operation.
- **Production identity.** The production client's identity is a readable string combining:
  - the model ID, a single constant that is also the value sent in both request paths;
  - its input budget;
  - a client-local format version.

  The format version is bumped when question encoding or score mapping changes. The exact separator is the implementer's choice.
- **Rejected alternative: a source hash.** Hashing the client's source code would re-judge everything, at cost, after harmless refactors.
- **Digest input.** The criteria digest takes the model identity as a new, required fourth input, after preferences, skills and the matching rules version. Because it is required, the type checker enforces that every caller supplies it.
- **Composition.** The search run's composition root passes the identity of the decision model it constructs. Nothing else reads the identity.
- **Version ownership.** The matching rules version keeps covering structured checks, question text, probability bands and thresholds, and stays at its current value. The client's format version covers encoding and mapping.
- **Accepted consequence.** Every existing workspace's criteria digest changes once, so all stored rejections are pruned at the next run start and judged again at model cost. Accepted vacancies are never pruned. The fixed digest used for accepted entries by the v1 migration does not change. This is stated in the README and the commit. Special-casing today's identity to avoid the cost was rejected as a permanent hack.
- **Documentation.**
  - The README's search workflow section explains that the digest covers the decision model's identity, and which version to bump for what.
  - The model replacement guidance notes that a model change re-judges rejections.
  - ADR 0009 gets an amendment paragraph, landing with the code.

## Testing Decisions

- Good tests here assert behaviour the job seeker would notice (which vacancies are judged again on the next run) or contracts other code relies on (the digest changes, the identity reflects the model). They don't inspect the format of the identity string beyond what it must contain.
- **Seam 1: the criteria digest.**
  - Changing only the model identity changes the digest.
  - The existing invariants still hold: budgets don't matter, and skill order and spelling variants don't matter.
  - The digest pin from issue 19 is updated to the new literal in this change, with the reason stated.
- **Seam 2: the search workflow with injected search memory, a fake decision model and a fake source.**
  - A rejection stored under the digest for one model identity is judged again on a run whose digest uses a different identity.
  - An accepted vacancy is not.
  - With the same identity, the rejection is skipped.

  Prior art: the existing workflow test where changed criteria and age re-inspect rejections but never applications.
- **Seam 3: the production decision model client with mocked HTTP.**
  - Its identity contains the model ID, the input budget and the format version.
  - The model sent on the wire equals the model ID in the identity.

  Prior art: the existing decision model tests that map questions and bound the wire body with mocked HTTP.
- No separate test for the composition root's wiring; the required argument makes the type checker enforce it.
- Fake decision models in all existing tests gain a fixed identity.

## Out of Scope

- Comparing the model a response reports against the requested one (a possible monitoring note for the matching accuracy evaluation, issue 01).
- Avoiding the one-off re-judge cost.
- Changing matching rules or bumping the matching rules version.
- Splitting the decision model port from its adapter (issue 10). The identity goes on the port either way.
- Storing the identity in search memory entries for diagnostics.
- Glossary changes, which are already made.

## Further Notes

- Blocked by the stored-format fixtures (issue 19), so the digest pin exists before this change updates it.
- Must land before any decision model is replaced or added.

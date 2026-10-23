# 14 — Include the decision model's identity in the criteria digest

Status: needs-triage
Type: task

`criteriaDigest` (`web/src/modules/applications/server/fingerprint.ts`) hashes `MATCHING_RULES_VERSION`, the target position, the skill threshold and normalised skills. It does not include which decision model judged the vacancies. Search memory prunes rejections only when this digest changes (or after 60 days), so switching the model (`typesafe/jev-1.14` today, hard-coded twice in `decision-model.ts`) without remembering to bump `MATCHING_RULES_VERSION` keeps rejections from the old model, and those vacancies are never re-judged by the new one.

Profile conversion already solves the same problem with provider cache identities (`claudeCacheIdentity`, `codexCacheIdentity` in `shared/ai/server/`).

Proposal:

- Add a `readonly identity: string` to the `DecisionModel` interface: model ID plus anything that changes answers (prompt/question format version, input budget). `DecisionModelClient` builds it from a single model ID constant, which also replaces the two hard-coded literals.
- Pass the identity into `criteriaDigest` from the composition root (`app/api/applications/run/route.ts`, or `prepareRun` from issue 06).
- Test fakes provide a fixed identity.

Consequence to accept: the first run after this lands changes every digest, so all stored rejections are pruned and re-judged once, which costs model calls. Accepted vacancies are never pruned, so the application list is unaffected. Mention this in the README's search workflow section. The migration's fixed `ACCEPTED_DIGEST` does not need to change.

Do this before replacing or adding a decision model. Done when changing only the model identity changes the digest (unit test), existing behaviour is otherwise unchanged, and tests, typecheck and lint pass.

## Comments

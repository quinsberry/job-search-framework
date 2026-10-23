# 10 — Split the decision model port from the Jev/OpenRouter adapter

Status: needs-triage
Type: task

`web/src/modules/search/server/matching/decision-model.ts` (about 317 lines) holds both the neutral port — the `DecisionModel` interface, question/answer/request/response schemas, `MatchError`, `validateAnswers`, `checkSignal`, `withCancellation` — and the concrete `DecisionModelClient` that calls `typesafe/jev-1.14` through `@typesafe-ai/sdk` and OpenRouter, with its fetch guard, retry and input budget.

The README says replacing the decision model means changing only `decision-model.ts`, but that file also defines the contracts matching depends on. Split it into `decision-model.ts` (port and neutral validation) and an adapter file (for example `jev-client.ts`) containing `DecisionModelClient`, its byte budget and transport details. Update the README's replacement instructions.

Pure move. If issue 03 lands first, apply the split in the new matching location. Done when tests, typecheck, lint and build pass.

## Comments

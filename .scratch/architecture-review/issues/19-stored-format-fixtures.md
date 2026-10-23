# 19 — Golden fixtures for stored workspace formats and the criteria digest

Status: needs-triage
Type: task

Several upcoming refactors move or split the schemas that read users' workspace files (issues 03, 09, 11, 12). A mistake there either fails to read existing workspaces or changes the criteria digest, which prunes and re-judges all stored rejections at model cost.

Add committed fixture workspaces covering every supported version: `applications/applications.json` v1, v2 and v3; `candidate-profile/profile.yaml` and `draft.yaml`; `search-preferences/config.yaml` and `draft.yaml`; `search-runs/inspected.jsonl`, including a pre-split workspace for `migration.ts`. Tests load each through the real repositories and assert the parsed result, and that migration produces the current format.

Pin `criteriaDigest` for a fixed preference/skills/rules input, so any change to it is deliberate and shows up in review. Issue 14 updates the pinned value once, intentionally.

Fixtures must contain fictional data only. Done when the fixtures and tests exist and pass.

## Comments

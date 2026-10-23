# 34 — Remove the v1 applications workspace migration

Status: needs-triage
Type: task

The applications module still migrates schema-version-1 workspaces: the old `applications/applications.json` with search memory kept beside it in `applications/inspected.jsonl`, moved to `search-runs/` on open. The maintainer has decided v1 workspaces no longer need support.

Remove the v1 migration, its schema, the call on workspace open and its tests. A v1 file should then be rejected with the ordinary unreadable-file error rather than migrated. Versions 2 and 3 stay supported and are covered by issue 19's fixtures.

Raised during triage of issue 19 (2026-10-24).

## Comments

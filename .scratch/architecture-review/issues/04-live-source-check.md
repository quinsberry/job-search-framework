# 04 — Opt-in live check for search source parsers

Status: needs-triage
Type: task

The LinkedIn adapter parses public guest HTML. Fixtures catch parser regressions, but not upstream markup changes, which users would discover as empty or failing runs.

Add an opt-in script (for example `bun run check-sources`) that performs one small live search and one detail fetch per source and reports whether summaries and details still parse. It must not run as part of `bun test`, must respect the existing request limits and cancellation, and should print a clear pass/fail per source.

## Comments

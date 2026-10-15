# Workspace search with application visibility

Status: resolved

## Request

The user invoked grill-with-docs to ask whether a plain request to find N jobs can use current profile/config, discover jobs, and return a list where applied vacancies can be checked. Explain current capability before proposing additions; keep the workflow modular and Python mechanics simple.

## Known contracts

- `jsf-profile export-search` reads current workspace YAML and exports validated JSON criteria. Professional facts are exported on demand, without a persisted JSON cache.
- `jsf-search` consumes criteria and returns qualifying matches, evidence/uncertainties and full snapshots. It owns no previous-run history or applications.
- `jsf-vacancies` imports search snapshots, deduplicates historical identities and tracks explicit shortlist/dismiss choices, separate from application status.
- `jsf-application` owns application CSV records. `ready` is not submitted; applied/screening/interviewing/etc. are tracked candidacy states. It records user-reported actions rather than submitting applications.
- The specialist operations can be composed conversationally. A dedicated coordinator and combined application-aware output need factual inspection before claiming they are available.

## Settled decisions — round 1

- Q1 accepted: N counts qualifying jobs excluding those with recorded submitted applications; show a shortfall rather than weaken criteria.
- Q2 clarified: a user-controlled checkbox means checked = applied, unchecked = not yet applied. The user must be able to check and uncheck directly, not just report changes conversationally.
- Q3 clarified: maintain one cumulative table/list of all tracked vacancies, adding new entries across searches. The user suggested a minimal interface (worded “minimal AI”; confirm UI intent).

## Initial interview questions

1. Does N count all qualifying vacancies or only ones without an existing application?
2. Does checking applied mean displaying recorded status, recording a user's submission, or an interactive UI control?
3. What list artifact is sufficient: chat table, saved readable list, or a separate application UI?

The user confirmed shared understanding and implementation in Q12–Q14 after the rounds below. The following frontier records the historical interview; final scope and verification appear at the end.

## Current frontier

- Harness-hosted interface versus standalone app, preserving direct persistent edits without an AI turn for each change. Astro is a possibility, not a chosen requirement. Future hosting/reuse matters, but a hosted multi-user service is not yet requested.
- Editable business fields versus immutable source observations/identifiers; user corrections must survive refreshes without rewriting evidence.
- Save interaction: per-cell automatic persistence with visible saved/error state versus an explicit save action.
- Exact table columns and any further integration prerequisites, then final shared-understanding confirmation.

## Settled decisions — round 2

- Q4 remains open: user considered Astro for local use and future hosting, but explicitly said a separate website is unnecessary if the harness can provide the interactive editor.
- Q5 accepted: unchecking corrects a mistaken applied mark, not withdrawal. Additional requirement: all table business fields must be editable, and edits persist.
- Q6 accepted: checking records an explicit submission claim without forcing salary/date/interview details; missing information remains unknown, not guessed. The application owner needs a focused checkbox operation.
- Q7 accepted: each request aims to add N newly discovered qualifying vacancies, excluding all already tracked rows, including unchecked ones. Prior rows remain visible; discovery limits can produce a shortfall.
- Core UX requirement: user edits directly through a comfortable minimal UI, without source-file editing and without asking AI to make each data change.

## Factual inspection

Independent read-only inspection confirms no orchestration helper, no application-aware search counting, no joined application-status list, and no checkbox UI/handler. Application duplicate checks use exact URLs; search/history expose canonical aliases. The workflow must bridge identities without company/title fuzzy matching and continue using the application's owning helper for mutations.

## Subscription-backed UI feasibility — 2026-10-15

The user paused UI decisions to ask whether a website could use each user's Claude/Codex subscription to run requests and render the responses. No implementation choice follows automatically from this investigation.

- OpenAI's [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart) documents eligible plan usage in third-party apps. Its [plan usage guide](https://developers.openai.com/siwc/token-sharing-open-source) covers open-source/locally hosted applications and directs paid/remotely hosted app developers to an interest form. Supported plan scopes, consent and Responses API requests are distinct from identity-only sign-in. The legacy Codex app-server authentication is not permission for a commercial hosted service.
- Anthropic's [subscription/Agent SDK support article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says SDK/headless/third-party usage can still draw from subscription limits. However, [SDK developer documentation](https://code.claude.com/docs/en/agent-sdk/overview) explicitly requires prior approval to offer claude.ai login or rate limits in a third-party product. Therefore personal SDK usage is not sufficient evidence of permission for a public bring-your-subscription website. API authentication is the documented developer fallback.
- Rendering validated structured agent results into a UI is an application architecture choice. Ordinary cell/checkbox saves can call Python persistence helpers directly without an AI request. The UI does not have to be model-generated HTML.

Open questions remain local/self-hosted versus public hosted product, provider eligibility/approval, and the pending interface/save/table decisions. Reverify provider documentation when implementing; these access rules are time-sensitive.

## Settled deployment decision

The user chose local-first after the subscription feasibility discussion. The interface, Python execution layer and persistent job-search workspace run on the user's machine. AI requests and live source searches still use external services. Public hosting, shared accounts and a multi-user service are outside the initial implementation. No independent cloud persistence or paid API requirement is implied by this decision.

Next decisions: first supported local AI runtime, minimal UI stack, then final confirmation of the editable-table/search scope. The user's prior requirement remains: direct persistent edits without an AI turn for each cell/checkbox.

## Final confirmation and delivered scope

The user accepted Q12 (Codex first), Q13 (plain HTML/JavaScript served by Python), and Q14 (the complete first-version scope). This authorizes implementation. The new `jsf-workflow` skill composes specialists without owning their facts/history/applications. Its local app runs on loopback and can be opened through the harness browser or a normal browser. Public hosting/Claude support remain deferred.

- Explicit workspace selection and fresh YAML export; missing required setup is reported without guessed preferences.
- Find N new qualifying jobs, excluding all history identities and all existing application records, even ready/unsubmitted ones. Continue beyond old matches without reading history inside search. Respect explicit discovery budget, including when it is smaller than N, and report a shortfall. An automatic budget follows requested N × 10. Config YAML is never overwritten by a transient requested count.
- Codex CLI uses the local ChatGPT login, structured output, an isolated read-only working directory, and a bounded timeout. API-key environment variables are removed to prevent silent API billing. The Python search evaluator validates every model quotation before history is written.
- One cumulative editable table; separate source observations and user corrections. Application checkboxes write through the application owner; unknown date/salary/work arrangement/interviews remain unknown. Unchecking corrects to ready rather than withdrawal, clears submission date, retains interview data, and confirms later-stage corrections. Legacy upgrades require confirmation and preserve a backup.
- Multiple candidacies require explicit selection for edits; the checkbox reflects the selected record, while filters/counts reflect any submitted candidacy. Selection cannot change while edits are queued/unsaved. Application-only records can be explicitly imported into the editable table with unverified posting activity/fit; their original CSV is preserved.
- Native input autosaves, Saving/Saved/Failed feedback, retained failed drafts and explicit retry/rebase. Stale revisions reject writes. Source evidence and computed fit remain read-only. Business edits call Python helpers without AI requests.
- All/Not applied/Applied filters, company/role filtering, expandable details and readable source/fit evidence. HTML is rendered from validated data, never model-produced UI markup.
- One app writer per workspace. In-process reads/writes are serialized while slow source/AI operations run outside the lock. The server binds to loopback, checks Host/session token/origin for writes and serves only its three fixed UI assets.

## Verification

- Automated checks cover owner-based persistence, checkbox unknowns/idempotence, preserved raw observations/corrections, identity bridges, candidacy selection, legacy upgrade/progress confirmations, stale edits, explicit application imports, malformed AI evidence, budget shortfalls, API-key removal, HTTP request boundaries and background search/edit coexistence.
- Independent forward testing completed the actual workflow in a fictional temporary workspace. It found selected-candidacy display and explicit-budget-count issues; both were reproduced and fixed, with regression coverage. The selected checkbox fix was independently rechecked.
- A real local Codex subscription call interpreted one fictional posting into structured facts; the existing evidence evaluator accepted it as a match. No live LinkedIn search was required for this verification; source acquisition was tested with fake adapters and real evaluator/history helpers.
- Browser testing in a temporary fictional workspace verified company edits, persistent checkbox updates, filtering, candidacy selection and a simulated failed save retaining its draft followed by a successful retry. Desktop/mobile inspection showed contained table scrolling without page overflow. Screenshots were inspected. Final test counts and commit are reported upon delivery.
- Final regression run passed 105 unittest cases plus the existing application CSV assertion suite; JavaScript syntax, diff whitespace and skill validation also passed. The independent N=6/budget=5 recheck inspected five, returned five, reported shortfall one and preserved configuration bytes.

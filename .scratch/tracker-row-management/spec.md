# Tracker row management and search-fit visibility

Status: resolved

## Request

Add vacancies manually, remove tracked vacancies so later searches can rediscover them, and remove the redundant Applied control in favor of Application status. Investigate rejected fit badges, junior vacancies despite middle/senior preferences, and hybrid vacancies outside Warsaw.

## Existing decisions to revisit

The table currently retains every inspected vacancy, including rejected and uncertain results. Search fit and application status are separate concepts, but the UI uses “rejected” for both. Previous-run exclusion includes history and application identities. Residence city and acceptable office locations are separate search fields.

## Design frontier

- Manual-entry minimum fields and assessment expectations.
- Removal semantics for saved vacancy history and linked applications.
- Application status as the only submission control.
- Default visibility and fit wording, pending code investigation.
- Location eligibility semantics, pending code investigation.

The user confirmed the complete scope after Q7; implementation is complete.

## Agreed round 1

Q1: Manual creation requires company, role and URL. Remaining fields are optional. Save as not assessed without automatic AI/discovery.

Q2: Remove the tracked vacancy and saved search history so future searches may rediscover/add it. Preserve linked application records and relink their statuses on rediscovery. Deletion must not leave application-identity exclusion preventing this behavior.

Q3: Work-location eligibility comes from the current search configuration. Hybrid/onsite office cities must satisfy configured acceptable office locations; residence is not permission to accept arbitrary cities.

The request explicitly removes the redundant Applied column/control; Application status remains the UI control. Existing application records and status behavior must remain compatible.

## Verified findings

The table displays all inspected vacancies, even rejected/uncertain ones. The rejected badge means search-fit rejection, not an employer decision. Current aggregate inspection found 55 rejected rows; seniority failed 45 and office location failed 6, with other checks unknown. Displaying them is not evidence they passed filters.

An additional role-mapping problem is contributing to rejection: interpreted role titles vary from configured canonical names, while the evaluator requires exact normalized overlap. Fix evidence-backed role mapping without accepting arbitrary substring matches.

## Remaining frontier

Default table visibility and fit wording; duplicate manual additions; agreed scope of role mapping correction. Implementation awaits final scope confirmation.

## Agreed round 2

Q4: Default main table includes matching, manually added, and application-linked vacancies. Other inspected vacancies are available through Show all inspected. Fit labels become Doesn't match preferences and Needs review, separate from application outcomes.

Q5: A manual URL already tracked opens the existing row, preserving current fields and application history.

Q6: Evidence-backed role variants should match configured roles rather than fail exact title wording. Seniority is evaluated separately. User clarification: Frontend Engineer may match configured Senior Frontend Engineer when compensation meets the requirement; compensation has priority over advertised title wording. Whether this overrides an explicitly incompatible seniority remains to be clarified.

## Current frontier

Clarify whether salary priority overrides only title wording or also an explicitly junior role. Once resolved, summarize the combined scope for final confirmation. No implementation changes yet.

## Agreed round 3

Q7: Compensation priority applies to title wording only. Explicit junior responsibilities still fail configured middle/senior seniority. Role scope, technical requirements, country eligibility and configured office locations remain enforced. Unknown mandatory evidence remains Needs review and does not count toward the requested matches.

## Final implementation scope

- Owner Python operations for manual creation (company, role and URL required), duplicate URL lookup, and vacancy removal with rediscovery.
- Preserve application records on removal and reconnect them on rediscovery; preserved application identities must not suppress deliberately removed vacancies forever.
- Thin workflow/server/UI integration; application status is the sole submission control in the table.
- Default table shows matching, manual and application-linked vacancies; Show all inspected exposes other saved assessments.
- Clear fit wording and supported role-title matching, with strict explicit seniority, compensation, technical and configured location checks.
- Existing specialist ownership and Python 3 conventions remain. Tests use fictional workspaces. The user confirmed this summary before implementation.

## Delivered

Implemented owner add/remove CLI and pure/Python operations, manual origin, duplicate lookup and optional identity-only rediscovery groups. Removal checks current revisions, removes observations/assessments/scope references and leaves application CSV untouched. Rediscovery restores old-ID links and consumes those identity groups. UI removal is disabled while a search runs so its accumulated snapshot cannot immediately resurrect a removed row.

The UI has Add vacancy, Details → Remove vacancy, Show all inspected, clear fit labels and Application status as its single submission editor. Supported title prefixes are ignored for role scope; interpretation maps evidence-supported canonical role and office names. Explicit seniority, compensation, technical and configured office checks remain enforced. Previously saved assessments are historical and are not silently rewritten.

Verification: 164 unit tests, application CSV checks, JavaScript syntax and diff checks, all three changed skill validators. Independent fictional-workspace forward testing exercised standalone CLI operations, byte-preserving duplicate selection, removed-row rediscovery/application relinking and role/pay/location evaluation. Browser testing exercised default/inspection views, manual creation, application status save, removal, recreation and reload persistence with no Applied checkboxes. No candidate workspace was changed and no live LinkedIn/Codex search was run.

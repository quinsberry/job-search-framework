# Clear setup progress and actions

Status: resolved

## Request

The user reports that CV import appears stalled at “Reading your CV and preparing the next step…”, the generic unfinished-drafts banner/Continue setup action is unhelpful, and Search preferences descriptions expose unfriendly details. They requested a design interview with documentation before implementation.

## Pre-change findings

- CV processing currently renders text with no visible loader or elapsed-time feedback.
- A workspace can contain independent profile and preferences drafts, but the banner names both and offers one generic action.
- Search readiness currently presents missing schema paths and raw validation messages directly in its card.

## Agreed decisions

- Q1: Show a visible loader, truthful processing stages and elapsed time for CV import, without invented percentages. Offer closing to continue later and cancellation.
- Q2: Remove the generic unfinished-drafts banner. Each setup card owns an explicit action for its own draft/progress/review state.
- Q3: Give preferences a plain-language purpose, concise missing-choice guidance and a clear setup/edit action. Put technical diagnostics in expandable details.
- Q4: Keep saved profile readiness separate from a new import/draft state. A running replacement does not invalidate usable saved information; only explicit Save replaces it.
- Q5: Keep loader/elapsed feedback while running. After one minute explain that it is taking longer and can continue in the background. Timeout/failure gives a clear explanation and explicit Retry, retaining the source and submitted answers. Do not retry automatically.
- Q6: When the dialog is closed, update the owning card with Answer questions or Review profile. Do not reopen automatically; retain the actionable status until addressed.

## Additional findings

Upload/extraction currently happen synchronously before the background AI state appears. The background turn has a five-minute deadline and cancellation support. A handler exists for Continue setup, but its destination depends on prior selection/newest draft. The investigation did not establish a universal no-op. Preferences currently expose raw schema keys/errors in their body text.

## Delivery

The user confirmed shared understanding with “go”. CV extraction now runs in the existing background worker, outside the workspace lock. Public progress includes confirmed phase/start time and retry capability; progress-only updates preserve the answer revision for cancellation. No new skills or artifact ownership changes were introduced.

The UI shows a spinner, ordered confirmed stages, elapsed time and a one-minute slow hint. Card-specific actions replace the generic banner. All running drafts continue polling even while the other editor is open; completed background work never forces a dialog open. Unchanged polling responses do not rebuild editors/progress panels. Preferences use plain-language summaries with expandable diagnostics.

Saved readiness and explicit Save semantics remain unchanged. Failed imports retain sources, pending uploads and submitted answers for explicit retry or replacement by an imported CV.

## Verification

150 automated tests plus application CSV checks passed across the owning skills, setup workflow, HTTP and fresh-process independence suites. Both frontend scripts passed syntax checks, and all six skills passed validation.

Browser interaction checks used a temporary fictional workspace with controlled AI responses. Verified loader/elapsed display, one-minute hint, saved-profile readiness during processing, preferences editing while profile runs, background Answer questions/Review profile card updates without forced navigation, friendly timeout copy and explicit Retry. Visual screenshots and DOM/interaction checks passed. Polling was adjusted to avoid rebuilding unchanged panels. No live AI/source calls or edits to real candidate facts were used for testing.

An independent forward pass verified reading/preparing/validating boundaries, cancellation during extraction/validation, retained CV/answer evidence after timeout, retry, and unchanged active profile/preferences drafts.

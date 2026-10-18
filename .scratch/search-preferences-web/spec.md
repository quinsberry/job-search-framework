# Web search preferences

Status: implemented; ready for review.

## Objective

Replace the placeholder Search Preferences section with a manual, typed form for the loaded workspace. Match Candidate Profile's recovery and explicit Save/Discard behavior. Store human-readable YAML independently from Python configuration. No AI connection or saved candidate profile is required.

## Agreed decisions

- One configuration per workspace, with one target definition. Selected titles and seniorities are acceptable alternatives within their respective fields.
- Manual editing only. No AI generation, CV inference, import wizard, named configurations or Python migration.
- Use workspace-local `search-preferences/config.yaml` and `search-preferences/draft.yaml`.
- Automatically persist unfinished edits for recovery. Only explicit Save activates validated preferences. A draft never invalidates the previous saved configuration.
- Discard removes the recovery draft and restores saved values, or the empty form when nothing has been saved.
- Confirmed Discard waits for in-flight work but does not flush edits being discarded. A previous recovery failure must not block the command. Server revision checks still apply; failed or conflicting Discard retains local values and reports the error.
- Detect external changes on writes, window-focus refetch and explicit reload. No continuous polling or filesystem watchers. An observed external revision marks the editor conflicted and offers reload without replacing local values or silently advancing their write revision.
- Flush both profile and preferences sessions before switching workspaces. A failed flush or target load retains the current workspace and edits.
- Work arrangements are a nonempty selection of remote, hybrid and on-site. Selecting all means no arrangement restriction.
- Location means candidate residence. Require city and country when hybrid or on-site is selected; both are optional for remote-only searches. Do not synchronize this value with the profile.
- Collect residence only. Commute radius, relocation and remote-country eligibility are outside this feature. Residence alone does not establish eligibility or an acceptable commute.
- `maxJobsToProcess` caps inspected vacancies; `maxJobsToMatch` is the desired qualifying result count. Both are positive integers, with match count no greater than process count. Do not invent business defaults.
- Salary restrictions are optional. An empty list means no compensation restriction. Each added band requires contract type, `min` (Baseline salary), currency, period and pay basis; `desired` (Target salary) is optional. Baseline is the minimum acceptable compensation; desired is the targeted compensation, not an upper cutoff. Require `desired >= min` when supplied.
- Reuse profile editor components where both features actually need them. Move reusable components to shared ownership and preserve profile behavior.
- Prefer Bun built-ins for new and touched code when they meet the required behavior. Retain Node APIs where needed for atomic replacement, locking or path safety. Verify capabilities against the installed Bun version; do not rewrite unrelated code just to remove `node:` imports.

## Schema review and proposed contract

The staged `web/src/modules/search/schema.ts` is the starting point. Preserve its existing seniority, position-type, contract-type, currency and period choices. Do not add new business categories in this feature.

Corrections needed before using it as a saved-data contract:

1. Use strict objects throughout. Current `z.object` schemas strip unknown keys rather than rejecting them.
2. Trim titles, reject empty/whitespace-only entries, and retain at least one title, seniority and position type. Enum selections must not contain duplicates.
3. Replace optional singular `remoteOption` with required nonempty `workArrangements`.
4. Keep the `location` object, label it Residence, normalize blank optional text to omission, and enforce the conditional city/country requirement.
5. Allow an empty `salaryRange` array. Move currency and pay period out of separate endpoints and onto each band; use numeric `min` (Baseline salary) and optional numeric `desired` (Target salary), replacing `max`.
6. Add explicit pay basis, distinguishing gross pay from net invoice amounts excluding VAT. Require finite positive amounts and `desired >= min` when desired is supplied. No currency conversion or tax calculation.
7. Require positive integer search limits and their cross-field relationship.
8. Define a single `searchPreferencesSchema` combining `targetPosition` and `settings`. Keep the existing inferred target/settings types and add the combined type.
9. Define a separate draft/form contract that can retain incomplete or invalid input, including temporarily empty or invalid numeric text. Draft validation enforces safe structure and bounded input; publication enforces business validity. Do not coerce empty numeric inputs to zero or discard invalid text during recovery.

Proposed saved band shape:

```ts
{
  contractType: 'permanent' | 'B2B';
  currency: 'USD' | 'EUR' | 'PLN';
  period: 'annual' | 'month' | 'hourly';
  basis: 'gross' | 'net-excluding-vat';
  min: number;
  desired?: number;
}
```

Use a versioned YAML envelope, for example `{ schemaVersion: 1, preferences: ... }`. Recovery metadata belongs in `draft.yaml`, not in the saved domain model. Row identities, if required by the form, remain editor metadata rather than salary criteria. Missing files mean no saved configuration; malformed files surface an error and must not be silently replaced.

## Reuse boundaries

Concrete reuse candidates found in the existing profile code:

- `ui/sections/controls.tsx`: move `TextField` and `ListField` to shared form components. Parameterize RHF field types instead of importing Profile `FormValues`; preserve typed field paths, labels, help, error association and focus refs. Replace the hard-coded `profile-` DOM ID prefix with instance-safe IDs so both forms can coexist.
- `ui/profile-fields.tsx`: move the small `ProfileField` card wrapper to a shared field-section component used by both forms. Do not make either entire editor generic.
- `ui/profile-progress.tsx`: extract the recovery-status presentation using status/error data and retry/reload callbacks. Conversion progress stays profile-owned.
- Reuse existing shared checkbox/select/input/field/card/dialog/button primitives directly. Add shared higher-level controls only when both editors need the same behavior.
- Reuse dialog primitives directly for preferences confirmations; keep upload/conversion choices in Profile. Do not generalize ProfileConfirmation's action union merely to accommodate search preferences.

The profile recovery session currently imports profile snapshots, row metadata and conversion jobs. Do not import it directly into Search or move that entire module unchanged into shared code. Extract only the common ordered-write/generation/flush/retry core into shared non-UI code, with domain-specific commands and conversion reconciliation retained in feature adapters. Preserve existing profile ordering and reconciliation tests. Shared code must not import either feature.

Give commands explicit ordering rules: Save and workspace switching flush pending edits; confirmed Discard cancels queued recovery scheduling, waits for already-running work, then issues the revision-checked discard without flushing the discarded values. After successful Discard, prevent old queued writes from recreating that draft. On failure, retain the current values. This intentionally corrects Profile's existing behavior that lets a failed recovery flush block Discard. Preserve its conversion guards and protection against late responses erasing newer edits.

Focus refetch updates server observations only. Route an observed external revision into conflict status rather than rebasing the write cursor or resetting the form. Distinguish external revisions from this session's accepted write/command acknowledgments; obsolete reads must not create false conflicts. Explicit confirmed reload adopts the newly read snapshot. Continuous detection while the window remains focused is not promised.

Use the existing Bun YAML, atomic replacement, path protection, locking and revision-check mechanics. Share only low-level filesystem helpers that both repositories need; keep filenames, envelope validation and publication/discard rules in each feature repository. No configurable repository framework.

Choose Bun's built-in facilities first where their documented behavior in the installed runtime satisfies the operation. API choice must preserve atomicity, exclusive creation, cleanup, symlink checks and error handling. A direct write to the published destination is not a replacement for atomic temporary-file publication. Keep the existing Node implementation where Bun has no equivalent required guarantee; do not add a Bun wrapper around it merely for naming consistency.

## Implementation sequence

1. **Model and validation.** Update the staged search schema deliberately; add combined saved/draft contracts and form mapping. Add focused tests for schema edge cases and draft round trips. Preserve unrelated staged work and `workflow/` files.
2. **Shared controls and recovery.** Extract the concrete reusable pieces above, update every profile caller and preserve profile behavior except for the agreed Discard correction. Implement the explicit command ordering and observed-revision conflict rules. Add instance-safe field IDs and scope invalid-field focus to the submitting form; the current global `document.querySelector('form ...')` can focus the wrong editor once both forms exist.
3. **Persistence and transport.** Implement load, persist-draft, save and discard operations under Search, exposed through a local API route. Reuse shared HTTP origin/body protections and typed response validation. Use atomic writes, a coherent publication commit/recovery protocol, and optimistic revision checks covering both YAML files. External edits or another tab must produce conflicts without losing local values. A crash after config replacement must not resurrect the just-published draft.
4. **Queries and editor.** Use TanStack Query for workspace/session-scoped server observations, including window-focus refetch, and RHF for editable values. Do not add preferences polling or filesystem watchers. Compose four form groups: target roles/employment types, residence/work arrangements, optional salary bands, and search limits. Provide add/remove salary rows, field-level errors, saved/draft status, recovery retry, explicit reload, Save and confirmed Discard. An empty workspace starts with an editable blank form; saving requires valid values. No business selections or numeric limits are silently prefilled.
5. **App composition.** Pass the shared loaded workspace and session identity to SearchPreferencesSection; remove its private directory selector. Register a preferences session handle alongside the profile handle. Flush both, validate/load both target snapshots, then dispose old sessions and accept the target. A failure retains both current editors. Deliberately loading the same folder creates a new session as it does today.
6. **Verification and docs.** Run focused behavior tests, then the web suite, typecheck, lint and production build. Browser-check both editors together with fictional data and no AI calls. Update README/domain documentation for the independent web preferences contract and agreed meanings; record the storage decision in an ADR during implementation.

Keep the existing Search section entry point. Organize model, client, UI and server responsibilities consistently with Profile, without creating pass-through files just to reproduce its directory tree. Keep `schema.ts` at its current path unless an actual project constraint requires moving it. No new dependencies.

## Required behavior checks

- Blank titles, unknown keys, repeated enum choices, invalid amounts, desired salary below baseline, fractional/zero limits and inverted job limits fail saved validation with useful field paths.
- Remote-only preferences may omit residence; hybrid/on-site requires city and country. No salaries is valid; each added band must be complete. Optional desired salary survives YAML without becoming a cutoff; legacy `max` is rejected by the new strict saved schema.
- Invalid numeric text and incomplete selections survive acknowledged recovery, refresh, discard and subsequent correction as appropriate.
- Rapid edits coalesce; writes serialize; edits arriving during a write remain pending. Save/Discard cannot race recovery writes. Failed recovery retains values and supports retry.
- After a recovery failure, confirmed Discard reaches the server without another recovery flush and succeeds when storage is writable. Test in-flight work and scheduled writes around Discard so discarded values cannot be written back afterward. A failed or revision-conflicting Discard retains local values; a late response cannot erase newer edits.
- Refetch never resets local edits or rebases their revision silently. Detect external YAML edits and second-tab writes on subsequent writes, window-focus refetch and explicit reload. Focus refetch of an external revision exposes conflict/reload even without local edits; accepted own acknowledgments and obsolete reads do not create false conflicts. Explicit reload adopts the current snapshot after confirmation. Continuous idle monitoring is outside scope.
- Save activates only valid preferences; failed publication preserves saved data. Interrupted publication reconciles config/draft consistently. Malformed YAML is surfaced without overwrite.
- A failed flush or target load prevents workspace replacement. Both editors remain usable afterward; late responses from old sessions cannot affect new ones.
- Existing profile recovery/conversion behavior remains intact after extraction, except that confirmed Discard can proceed after failed recovery. Shared controls retain accessible labels/errors and unique IDs. Validation focuses an invalid field in the correct form.
- Browser flow: new config, edit, recovered incomplete draft, Save, more edits, Discard, refresh, conflict/reload, and workspace switch while both editors have pending edits.

## Ponytail ultra review

The complete vertical feature needs schema, durable storage, transport, form state and workspace coordination; a UI-only change would leave recovery incomplete. Reuse is justified by two actual editors, but only for shared controls and durability mechanics. Keep feature-specific forms, business validation, repositories and AI behavior separate.

Skip a generic schema-rendered form engine, generic feature repository, reusable editor framework, AI setup, live search execution, Python compatibility, continuous preferences polling/watchers, unrelated Node-to-Bun rewrites, YAML comments preservation and geographic/tax calculations. YAML formatting/comments may be regenerated on save, as for Candidate Profile.

## Current validation status

Implementation was authorized after the architecture review. Search now owns its schema/form mapping, transport, queries, session adapter, editor and YAML repository. Shared typed controls, recovery status, ordered durability and safe file mechanics serve Profile and Search. The HTTP route delegates directly to repository commands; there is no pass-through application layer.

The agreed Discard correction is implemented in the shared session. It cancels scheduled writes, waits for running work, checks revisions and retains newer edits or failed commands. Preferences focus refetch detects external revisions without resetting form values; query cancellation and acknowledged snapshot identity distinguish stale observations from fresh external file rollbacks.

Bun 1.4.3 supplies YAML, file reads, SHA-256 hashing and lock-wait timing. Node APIs retain exclusive temporary creation (`wx`), atomic rename, directory locks and symlink/path checks because those guarantees must survive extraction. Existing Profile cache derivation and fixtures remain valid.

Verification: 76 web tests pass, typecheck and production build pass, and lint has no errors. Six pre-existing unused-import warnings remain in the unrelated application table. The stale Profile mock path in the existing workspace test was corrected, and both-editor flush/load failures now have coverage. New checks cover saved/draft validation, numeric-text recovery, salary semantics, failed and interrupted publication, external-file conflicts, failed-recovery Discard, in-flight ordering, focus/refetch and subsequent edits after commands.

Browser interaction checks used only a temporary fictional workspace and no AI calls. They covered editing without a profile/connection, validation, manual publication, salary controls, incomplete draft recovery after refresh, Discard, external YAML change detection and confirmed reload. Shared controls were also exercised with both editors present. The collaborative preview's screenshot/snapshot capture failed; rendered DOM and interactions were inspected through its evaluation tools instead.

Documentation: `web/README.md`, root `CONTEXT.md` and ADR 0006 record the independent web contract and agreed meanings. Unrelated `workflow/` content and the user's staged work were left intact; implementation changes are uncommitted.

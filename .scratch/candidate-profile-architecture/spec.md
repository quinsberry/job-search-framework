# Candidate Profile architecture refactor

Status: ready-for-human

The approved architecture and both ponytail-review resolutions are implemented. The change is ready for human review; implementation and validation notes are recorded below.

## Objective and agreed scope

Reorganize the complete Candidate Profile dependency path for low coupling, high cohesion and maintainability as more features/providers are added. Retain the local Bun/Next.js runtime and current user workflow, profile schema, YAML layout, recovery guarantees and token reuse. Hosted execution, multi-user infrastructure and distributed workers are outside this refactor.

This plan follows the current working tree, including fixes/tests added since the initial implementation. It does not revert those changes or overwrite unrelated formatting/search work. The original behavior specification remains `.scratch/candidate-profile-web/spec.md`; this document governs internal reorganization.

The user has installed `@tanstack/react-query` (`^5.104.4`, observed in web/package.json). Reuse it. Retain React Hook Form, Zod, Bun YAML, PDF.js and the installed shadcn primitives. No additional state-machine or general state-store dependency is required by this plan.

## Problems to remove

- The editor combines form rendering, draft write ordering, polling, revisions, recovery, notifications and browser lifecycle handling.
- Workspace and agent sections import profile-owned context; that context combines unrelated workspace, provider and profile state.
- Server snapshots and metadata are mirrored across context, local variables and refs. Recovery behavior is inferred from display strings and overlapping flags.
- Shared Codex infrastructure imports the profile schema, builds profile-specific prompts, hard-codes the provider ID and mutates shared identity during readiness checks.
- The HTTP client accepts arbitrary records and caller-selected result types; request shapes are repeated across callers and the route.
- Conversion orchestration knows YAML formats/cache filenames and mutates repository state through a generic callback interface.
- Form field names require casts, and display metadata also determines empty domain records. Stable record identity is maintained in parallel positional arrays in the view.

Moving this code into one large hook would not meet the objective. A module must remove knowledge from its callers, rather than just relocate it.

## Ownership and dependency rules

| Concern | Sole owner | Callers do not know |
| --- | --- | --- |
| Selected/loaded workspace | Workspace module | Profile snapshots, form state, provider checks |
| Provider selection/readiness | Agent module | Profile schema, extraction prompts, YAML |
| Server profile snapshots and conversion status | Profile queries | UI layout, unsaved field values |
| Unsaved values, field validation and rows | Profile form | HTTP, filesystem paths, provider execution |
| Debounce, ordered draft writes, acknowledgments and flush | Profile recovery session | React rendering or shadcn |
| Profile commands and conversion policy | Profile application module | HTTP parsing or JSX |
| Persisted facts, drafts and checkpoints | Profile persistence | React, HTTP or Codex subprocesses |
| CLI execution and provider adaptation | AI adapter | Candidate Profile fields or business policy |
| Composition and workspace-switch coordination | App composition | Queue internals, YAML or field implementation |

Dependency direction:

1. App composition connects independent workspace, agent and profile interfaces.
2. Profile UI depends on its form/session/query interfaces and shared UI primitives.
3. Profile server commands depend on domain validation and injected persistence/AI adapters.
4. Shared AI and shared UI never import a feature module. Workspace and Agent never import Profile.
5. Client imports cannot reach Bun/filesystem/process implementations. Shared transport contracts contain only portable schemas/types.
6. Cross-module imports use explicit public entry points. Internal code uses direct local imports; avoid broad barrel exports that mix client/server code.

## Approved module organization

Paths describe cohesive responsibilities, not a requirement to create a file for every function. Keep the current public CandidateProfile component path stable.

```text
web/src/
  app/
    page.tsx
    providers.tsx                    QueryClient lifetime
    workspace-content.tsx            composition and leave-before-switch policy
    api/
      workspace/route.ts             workspace validation/loading
      agent/route.ts                 provider readiness
      profile/route.ts               profile operations
  modules/
    workspace/
      contracts.ts
      workspace-session.tsx          loaded workspace and restoration
      workspace-section.tsx          folder-selection UI
    agent/
      contracts.ts
      api.ts                         typed HTTP operations
      queries.ts                     readiness queries
      agent-session.tsx              selected provider
      agent-section.tsx              selection/connection UI
    profile/
      candidate-profile.tsx          section composition only
      model/
        schema.ts                    candidate facts and validation
        contracts.ts                 portable requests/results/errors
        form-model.ts                form rows, IDs, defaults and mapping
      client/
        api.ts                       typed operations and validated responses
        queries.ts                   workspace-scoped server state
        recovery-session.ts          React-independent state and ordered writes
        use-profile-session.ts       lifecycle integration with React/RHF/queries
      ui/
        profile-form.tsx             form ownership and submission
        sections/
          identity-fields.tsx
          experience-fields.tsx
          skills-fields.tsx
          education-fields.tsx
          certification-fields.tsx
          language-fields.tsx
        profile-progress.tsx         progress display and isolated elapsed clock
        profile-confirmation.tsx     existing confirmation UX
      server/
        application.ts               named profile operations
        conversion.ts                extraction/interpretation workflow
        extraction.ts                existing PDF/Markdown mechanics
        persistence.ts               YAML, atomic writes and checkpoints
  shared/
    ai/
      contracts.ts                   domain-neutral provider interface
      server/
        codex.ts                     CLI execution adapter
        providers.ts                 provider registration
    components/
      select-directory-button.tsx
      upload-file-button.tsx
      ui/                            existing shadcn primitives
```

Each extraction should have a concrete reason to change independently: field presentation, recovery ordering, transport, conversion policy or storage. Do not add pass-through classes or duplicate service layers simply to fill this tree.

Tests live beside their owning modules, such as recovery-session.test.ts, form-model.test.ts, application.test.ts and persistence.test.ts. The tree is an approved responsibility map, not a file-count target; tightly related implementation may stay together where a split adds no useful separation.

## Module interfaces and invariants

### Workspace and app composition

Workspace exposes the selected folder, validated loaded-workspace identity, load status and an open operation. Remembering the folder remains a workspace concern. Loading the same folder deliberately creates a new editing session, preserving the current reload fix.

App composition owns the switch sequence: ask the active profile session to prepare to leave, validate/load the target, then replace the active workspace. A failed flush or load retains the old workspace and its edits. Keep this explicit through a session handle supplied to composition; do not restore a profile-specific flusher registration inside workspace context.

The profile session exists for the loaded workspace lifetime, independently of whether the editor panel is expanded. Re-rendering/collapsing must not recreate the recovery queue. Dispose a previous session only after successful flush/switch, or an explicit discard decision.

### Agent and shared AI

Agent exposes selected provider ID, readiness data and an explicit connection check. Readiness is server state and uses the query layer. Its UI does not call a profile endpoint.

The shared provider interface accepts a structured interpretation request containing instructions, input text and JSON output schema, plus cancellation. It returns output data. Readiness returns immutable provider identity/capabilities along with availability; it does not mutate an exported singleton.

Profile conversion constructs its own prompt/schema and validates output. Provider-specific execution details stay in the adapter. Cache identity combines the selected immutable provider/settings identity with profile extraction/prompt/schema versions. Adding Claude should require an adapter, registration and availability metadata; form/recovery logic must be untouched. Claude implementation remains outside this refactor.

#### Existing conversion-cache compatibility

This structural refactor must preserve existing Next.js cache keys, identity strings, source names and checkpoint filenames for unchanged conversion behavior. Returning identity as immutable data changes its ownership, not its value or serialization. Do not hash the complete readiness response, display messages, capability objects or incidental object-property order.

Freeze the current derivation before moving it: source name is SHA-256 of original bytes plus the normalized `.pdf` or `.md` suffix; cache key is SHA-256 of `sourceName + ':' + cacheIdentity`. The current checked Codex identity is `codex-cli:<trimmed CLI version>:default:profile-v1`. Keep the existing `text.txt`, `raw-output.yaml` and `result.yaml` checkpoint names and formats. Confirm these details against the actual starting tree and capture fictional compatibility fixtures before implementation.

Prompt/schema/extraction behavior and its version remain unchanged in this refactor. Future semantic changes may deliberately introduce a new conversion version; they must not reuse incompatible results. This is compatibility with the current Next.js implementation, not with Python artifacts.

### Profile application and transport

Expose named operations equivalent to read snapshot, start import, retry import, persist draft, publish and discard. Define concrete request/result/error types once. Client functions infer their results from these contracts; remove the caller-selected generic response assertion.

HTTP handlers enforce local origin, body limits and request validation, then delegate. The application module owns profile rules and wires the workflow to adapters. Separating workspace and connection transports from profile is allowed; the browser-visible behavior and YAML contract remain stable.

Persistence exposes domain-oriented snapshot, publication, draft and conversion-checkpoint operations. YAML serialization, paths, lock handling and atomic replacement remain private. Generic path reads/writes and unrestricted state-change callbacks must not be the interface used by conversion orchestration. Reuse the proven locking/publication mechanics while changing their interface.

### Profile queries

TanStack Query owns the server snapshot for each loaded workspace. Provide typed query options/keys, active-job polling and mutation state. Components consume selected data and intents; they do not maintain a second snapshot in context/state/refs.

- Consume cancellation signals. Cancel or disregard obsolete reads around mutations and session changes so late reads cannot roll back acknowledged state.
- Scope keys to workspace/session as needed; never use previous-workspace placeholder data for an active editor.
- Keep conversion-start/retry mutations explicitly invoked with automatic retries disabled. Read refresh/retry must never start interpretation.
- Refetching/focus/reconnect update server observations only. They do not reset edited form values or publish anything.
- The query cache is not durable recovery storage. Do not persist profile contents in browser storage.
- Use local-app networking semantics deliberately so a browser's internet-connectivity heuristic cannot block localhost recovery writes.

### Profile recovery session

Create one React-independent session per active editing session. Its small interface supports observing state, recording a changed draft, flushing, explicitly retrying recovery, reconciling accepted server events and disposing. Inject the draft writer and scheduling dependencies rather than importing HTTP or React.

Represent recovery with explicit typed states such as clean, pending, writing, failed and conflicted. Messages are derived from state; never inspect a human-readable status string to decide behavior. Track submitted/acknowledged generations and a write cursor internally. The cursor is a command precondition, not another copy of the server snapshot.

Required ordering invariants:

- Coalesce pending edits; serialize writes and advance expected revisions only from accepted write acknowledgments or the explicit reconciliation events below. Initialize the cursor from the deliberately loaded starting snapshot.
- An acknowledgment marks only its submitted generation as durable. Newer form edits remain pending.
- Publish, discard, upload replacement and workspace switching enter through a defined flush/command sequence; they cannot race pending draft writes.
- A conflict retains values and blocks unsafe writes until explicit reconciliation. A query refetch cannot silently rebase the write cursor.
- A stale response from another workspace/session cannot update the active form or its durability status.
- A conversion result is applied once to its originating session. It cannot erase edits made after the initiating operation. Keep the current guard for loading active conversions into an existing editable draft.
- Failed writes retain pending data and expose explicit retry. Disposal does not claim unacknowledged edits are durable.

A thin React adapter subscribes to this session. Do not expose queue promises, revision refs, debounce timers or arbitrary setters to JSX.

#### Explicit reconciliation interface

Expose one typed `reconcile(event)` operation. It is the controlled handoff from successful commands and matching conversion observations into session state. Events identify their workspace/editing session, command or job, returned revision and relevant submitted generation. Capture those identities when starting the operation, not when its response arrives.

| Accepted event | Cursor and baseline behavior | Form-value behavior |
| --- | --- | --- |
| Save succeeds | Adopt the returned revision and published baseline; acknowledge only the submitted generation. | Keep any edits made after submission. |
| Discard succeeds | Adopt the returned revision and saved profile after the confirmed discard sequence. | Replace only the explicitly discarded local changes; do not let an old discard response erase later edits. |
| Matching conversion finishes | Adopt its final revision once and, on success, the persisted conversion draft. | Apply successful output once when safe; retain newer edits. Failed/interrupted conversion retains the prior editable draft while exposing its new revision/status. |
| User explicitly reloads | Adopt the deliberately loaded revision/baseline after pending edits are resolved. | Replace values only under the explicit reload/switch decision. |

Upload/retry start acknowledgments may advance the cursor for their matching commands without resetting the form. Ordinary draft-write acknowledgments retain their generation-aware behavior. A terminal job observed after restoring an active conversion belongs to the restored workspace/session's tracked job; a page reload must not make its result permanently ineligible.

Query refresh/focus/reconnect observations update the query cache only. The session integration may turn a matching tracked terminal job into an explicit reconciliation event, but arbitrary query revisions cannot silently rebase the write cursor. Reject duplicate, obsolete and other-session events. If newer local edits make replacing the form unsafe, retain them and require explicit reconciliation rather than quietly accepting a destructive baseline.

The recovery module returns state/decisions; the form adapter applies approved form changes. React hooks must not invent separate revision setters or baseline-reset rules. Specify and test the command ordering, including pending/in-flight writes, before connecting the UI.

### Profile form and UI

React Hook Form owns editable values. Use explicit IdentityFields, ExperienceFields, EducationFields, SkillsFields, CertificationFields and LanguageFields composed from existing shadcn controls.

Stable noneditable identity travels with each form row internally. One model mapping translates form rows to/from the existing facts and parallel persisted metadata. Adding/removing a row changes one form structure; views do not keep a second positional identity list. This mapping must preserve the current YAML shape and existing IDs across load/edit/save.

Create empty records from typed domain defaults/factories, not display metadata. Avoid the generic string-based field renderer and casts that bypass field-name checking. Keep UI labels/help in their respective sections. Reuse small shared UI only where actual repeated behavior justifies it; no new form framework or replacement primitives.

Subscribe to values/errors close to the controls that need them. Isolate save eligibility/dirtiness calculation so each keystroke does not rerender the whole section or connection UI. Preserve comparison against the saved baseline, including after recovered drafts and normalized optional values.

## Effect policy

No zero-effects target or line-count threshold. Every effect must identify the external system being synchronized and its owning module.

| Synchronization | Placement |
| --- | --- |
| Snapshot loading/polling/cancellation | TanStack Query |
| RHF changes flowing into recovery | Thin form/session subscription adapter |
| Browser unload warning for unacknowledged edits | Focused browser-lifecycle adapter |
| Remembered workspace observation/bootstrap | Workspace module |
| Elapsed-time clock | Progress display hook |
| Recovery debounce and write scheduling | Recovery session implementation |

Remove the latest-snapshot mirror effect. Do not use effects for derived values, user-command dispatch, notification chains, or copying query data into local state. A real query-completion observation belongs in the session integration and must be guarded by job/session identity, not spread through component effects.

## Refactoring sequence

1. Pin the actual current tree and existing behavior tests, including newer client/repository fixes. Capture fictional pre-refactor cache fixtures and freeze unchanged cache identity/key behavior before moving code. Record dependency rules and public interfaces. Do not fold unrelated staged formatting/search changes into this work.
2. Establish portable typed transport contracts and explicit client/server entry points. Replace unsafe generic client calls and preserve transport security/size limits.
3. Separate workspace and agent ownership from Profile. Put switch coordination in app composition and add a stable QueryClient provider. Preserve folder restoration and same-folder reload behavior.
4. Introduce profile/agent query definitions and named mutations; remove manual polling and mirrored server-snapshot ownership. Keep form values independent and conversion retries explicit.
5. Build and verify the React-independent recovery session, including typed reconciliation for command results and tracked conversion completion. Route ordered draft writes and flush/command sequences through it; delete superseded refs/effects instead of layering a second implementation alongside them.
6. Introduce the form-row mapping and explicit typed sections. Connect RHF to recovery through the thin adapter; isolate progress/confirmations and reduce CandidateProfile to composition.
7. Invert shared AI dependencies and return immutable readiness identity. Move prompt/schema policy into profile conversion. Hide persistence formats/paths behind domain operations while retaining working atomicity, reconciliation and checkpoint logic.
8. Remove obsolete context, generic renderer, helper wrappers and implementation-coupled tests after their replacements pass. Update architecture docs/ADR and run complete checks/reviews.

Each stage must keep a working vertical path. Preserve accepted tests where they describe behavior; replace tests that depend on retired internals rather than carrying both suites indefinitely.

## Acceptance and test seams

- **Recovery session:** latest-change coalescing, ordered revisions, edits during an in-flight write, failed flush, explicit retry/conflict, command ordering and disposal. Test commands/observations with a deterministic scheduler and fake writer; no React required.
- **Reconciliation:** after accepted Save, Discard, conversion completion and explicit reload, the next edit uses the accepted revision and succeeds. Also cover upload/retry acknowledgments, failed/interrupted terminal jobs, restoring an active conversion, duplicate/stale events, other workspaces/sessions and newer edits arriving before a command response. Ordinary refetch must not advance the cursor or reset values.
- **Typed client/transport:** request/response validation, structured errors, origin/size protections and cancellation. Client callers cannot assert arbitrary return types.
- **Form integration:** six sections, add/remove identity preservation, optional fields/lists, visible nested errors/focus, saved-baseline reversal, same-workspace reload and late acknowledgment preservation.
- **Query integration:** workspace isolation, read-only refetch semantics, active-only polling and no automatic costly mutations. Refetch never resets unsaved fields.
- **Application/persistence:** unchanged YAML/schema versions, external-file/second-tab conflicts, publication reconciliation, interrupted conversion recovery, reuse of validated and raw completed output, and failed replacement preserving old data.
- **Existing-cache fixtures:** use fictional files created in the current Next.js format before refactoring. Re-upload unchanged bytes/settings and reuse completed validated output without invoking interpretation. Separately resume persisted raw output through validation without interpretation. Make the mock interpreter throw immediately if called in either reuse case. Verify different bytes or genuinely different conversion settings do not reuse incompatible output; no automatic paid fallback is permitted.
- **AI adapter:** mock and real adapter satisfy one neutral contract; shared AI imports no profile module. No live paid interpretation is needed for verification.
- **Architectural checks:** focused import restrictions using existing lint tooling, client/server import separation and public feature entry points. Avoid a new architecture framework solely to enforce folders.
- **Change-locality review:** demonstrate where a hypothetical Claude adapter and a new profile field would be added. Claude must not require edits to profile UI/recovery/persistence policy; a field change must not require edits to transport, query scheduling or workspace switching.
- Run current web tests, typecheck, lint and production build. Browser-check the unchanged workflow with fictional data; preserve the no-live-token test approach. Report baseline failures separately.

## Completion criteria

CandidateProfile composes the feature and exposes user intents. The form does not know HTTP/provider/storage details. Workspace/Agent do not depend on Profile. Shared AI is domain-neutral. The server application owns profile policy; persistence owns physical formats. Each state has an explicit owner and justified lifecycle. Recovery correctness is testable without mounting the UI.

All product/architecture interview decisions and the directory/file overview are approved. Both ponytail-review findings are implemented: explicit revision/baseline reconciliation and compatibility fixtures for existing conversion caches.

## Implementation and validation

- Workspace and Agent are independent modules. App composition flushes and validates before switching and creates a new editing session for deliberate same-folder reloads. QueryClient lifetime belongs to the app provider.
- Profile is organized into `model/`, `client/`, `ui/` and `server/`. CandidateProfile composes the section. `ui/profile-editor.tsx` connects import/status/confirmation and session interfaces; `ui/profile-form.tsx` owns RHF setup, validation, fields and submission without provider/HTTP/storage knowledge. The additional editor file keeps these responsibilities separate rather than combining them into the form.
- TanStack Query owns snapshots, cancellation and active-job polling. The independent recovery session owns debounce, serialized writes, generations and typed reconciliation; ordinary refetches cannot rebase the cursor or reset form values. Tests cover late acknowledgments, command ordering, restoration, conflicts, disposal and next edits after reconciled revisions.
- Six explicit typed field sections replace the generic string renderer. Stable row IDs travel with form rows; mapping preserves the existing persisted facts/metadata shape. The superseded workspace context, generic client/renderer and editor refs/polling are removed.
- Named application commands use injectable neutral AI and persistence interfaces. Persistence hides formats, paths and generic mutation callbacks. Shared AI no longer imports Profile or mutates a singleton identity. Shared local HTTP validation serves all three transports.
- Current source hashes, Codex identity spelling and checkpoint formats remain unchanged. Frozen fictional fixtures cover validated/raw reuse, changed bytes and changed settings; interpretation throws if reused fixtures unexpectedly invoke it.
- ESLint enforces feature independence and portable/client/server import boundaries. README and ADR 0005 describe ownership, cache compatibility and where future provider/field additions belong.
- Verification: 55 web tests pass, TypeScript passes, production build passes, and lint has no errors. Six existing unused-import warnings remain in the unrelated application table.
- Production-browser checks with a temporary fictional workspace and fake Codex covered upload, observed progress, collapsed completion, six field sections, manual publication, post-Save edits, refresh recovery, saved-value reversal, nested validation/focus, discard and a successful subsequent Save. Two identical uploads used one fake interpretation. No live AI tokens or real candidate data were used.
- Existing unrelated staged/unstaged work was retained. This refactor is left uncommitted for review.

## References

- Original behavior: .scratch/candidate-profile-web/spec.md
- Existing storage decision: docs/adr/0005-independent-web-candidate-profile.md
- https://react.dev/learn/you-might-not-need-an-effect
- https://tanstack.com/query/latest/docs/framework/react/overview
- https://tanstack.com/query/latest/docs/framework/react/guides/mutations

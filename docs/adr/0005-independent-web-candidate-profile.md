# Independent web candidate profile in YAML

## Status

Accepted, 2026-10-18, through the Candidate Profile implementation interview.

## Context

The Next.js Candidate Profile section needs PDF/Markdown import, editable fields and durable recovery. The user explicitly rejected Projects and experience-location fields and raw Markdown editing. Human-readable profile storage is still required.

## Decision

Use a separate TypeScript/Zod model and versioned YAML under a new workspace namespace, `candidate-profile/`. `profile.yaml` contains published facts. `draft.yaml` contains recovery values, revisions, record identities and conversion state; sources and expensive-stage results remain reusable independently of publication. Use Bun's YAML APIs, atomic file replacement and optimistic revision checks.

Use a small server-side AI provider interface. Codex CLI with the user's existing ChatGPT login is the first adapter. Manual edits and publication do not call AI. Connection checks and status polling do not start conversion. Failures/restarts require explicit retry before repeating unfinished AI work.

## Consequences

Only six profile sections exist in the web schema.

The first implementation targets a long-running local Bun/Next.js server. A server crash can interrupt an active provider call; acknowledged stages and drafts remain recoverable. This is not a serverless job queue. YAML comments/formatting may be regenerated on Save.

## Architecture refinement

The approved architecture refactor separates Workspace, Agent and Profile. App composition owns leaving an editing session before switching workspaces. TanStack Query owns server observations; React Hook Form owns editable values. A React-independent recovery session serializes draft writes, tracks submitted generations and accepts typed command/job reconciliation events. A background refetch cannot reset local values or silently rebase the revision used for writes.

The profile application owns commands and interpretation policy. Persistence owns physical YAML/checkpoint formats, paths and atomicity. Shared AI adapters accept instructions, input text and output schema without importing profile types. Readiness returns an immutable cache identity rather than mutating a provider singleton.

Structural reorganization preserves the existing web source hashes, normalized suffixes, cache identity spelling and checkpoint formats. It must not cause another paid interpretation for compatible cached output. Actual prompt/schema/extraction changes require a deliberate conversion-version decision. This constraint protects current web workspaces.

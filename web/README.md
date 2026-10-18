This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Folder selection uses `Bun.spawn` through a Next.js server action. The dev, build
and start scripts run Next.js with Bun. On macOS the picker uses the system
folder dialog via `osascript`; Windows uses PowerShell's folder dialog; Linux
requires `zenity`. Python is not required for this picker.
Selection is restricted to the local app and returns an absolute
path on the computer running Next.js, or `null` when cancelled.

`SelectDirectoryButton` provides successful selections to a client component
through `onSelect(path)`. Cancellation preserves the previous selection.

Run the folder-selection checks with `bun test src/shared/actions/select-directory.test.ts`.

## Candidate Profile

Run this app with Bun using `bun run dev`, `bun run build`, and `bun run start`.
Load a workspace, then use Connect to check an installed Codex CLI with an existing
ChatGPT login (`codex login` in your terminal). Claude is not implemented yet.
Profile editing and saving work without an AI connection. Upload and conversion
require a connection; no conversion starts automatically on page load or refresh.

Upload a text PDF or UTF-8 Markdown CV (`.pdf`, `.md`, `.markdown`, up to 10 MiB).
PDF extraction uses PDF.js, with a limit of 100 pages and 120,000 extracted
characters. Encrypted, malformed and image-only PDFs need a readable text version;
OCR is not supported. Conversion shows observed stages and elapsed time, then
exposes a collapsed field editor. Expand it to edit/add/remove entries and Save.

The new app writes only its own namespace in the selected workspace:

```text
candidate-profile/
  profile.yaml                 # published facts
  draft.yaml                   # recoverable edits, record IDs and job state
  sources/<sha256>.pdf|md       # retained original bytes
  conversions/<sha256>/        # extracted text and reusable conversion output
```

Published YAML is `{ schemaVersion: 1, profile: { identity, experience, skills,
education, certifications, languages } }`. These fields follow
`src/modules/profile/model/schema.ts`. Projects and experience locations are not stored.
Language proficiency uses only Unknown (empty), A1, A2, B1, B2, C1, C2 or Native.
The editor has no custom text option. Existing profiles or drafts with other
proficiency values must be corrected to one of these levels before loading.
New saves also include a `publication` envelope with the published draft ID and
record IDs. The atomic replacement of `profile.yaml` commits Save. If clearing
`draft.yaml` fails afterward, readers use this marker to recognize the saved
profile and avoid recovering the already-published draft. The next draft write
finishes cleanup. Older profile files without this metadata remain readable.
YAML is validated on every read/save; unsupported fields or versions produce an
error instead of silently losing values. App Save may rewrite comments/formatting.
External edits and concurrent tabs are protected by revision checks.

Edits are saved to the recovery draft after a short debounce, independently of
explicit publication. Wait for “Draft saved for recovery” before closing. Failed
recovery writes remain visible; controlled workspace changes flush pending edits.
The browser remembers only the workspace path, not CV/profile contents.
Loading a workspace again refreshes the editor from disk, including when the
selected folder has not changed. Recovery acknowledgments preserve current input.

Completed conversion stages are persisted and reused for identical source bytes,
provider/CLI identity, and extraction/schema/prompt version. Polling and reopening
do not repeat AI work. A failed or interrupted conversion needs explicit Retry;
an unfinished provider call may consume tokens again. A failed replacement keeps
the previous editable draft and saved profile. Discard removes the draft but
retains reusable conversion results.

This is an independent implementation: Python configs, profiles and drafts are
not read or migrated. Keep the local Bun server running while converting. Jobs
survive closing a browser tab, but server termination interrupts unfinished work;
the next load exposes recovery rather than silently restarting it. Codex uses a
five-minute timeout and a temporary read-only working directory with unrelated
tools disabled. No hosted/serverless execution is supported.

Run `bun test` for the web tests, `bunx tsc --noEmit` for typechecking, and
`bun run lint` / `bun run build` for integration checks. Tests use fictional
workspaces and mocked AI, without spending conversion tokens.

### Architecture

`app/workspace-content.tsx` composes independent Workspace, Agent and Profile
modules. It flushes the active editing session and validates the target before
switching; failed flushes/loads retain the old editor. A deliberate same-folder
reload creates a new session. `app/providers.tsx` owns the stable QueryClient.

Within `modules/profile/`, `model/` holds portable schemas and the mapping between
form rows and persisted facts/IDs. `client/queries.ts` owns workspace/session-scoped
snapshots, cancellation and active-job polling. The React-independent
`client/recovery-session.ts` owns debounce, ordered writes, acknowledged generations
and explicit command/job reconciliation. Ordinary query observations cannot reset
the form or silently advance its write cursor. `client/use-profile-session.ts`
connects that session to RHF and the browser lifecycle. `ui/` owns six typed field
sections, focused subscriptions, confirmations and the isolated progress clock.

`server/application.ts` exposes named profile commands. Conversion owns the
profile prompt/schema policy; `server/persistence.ts` hides YAML, paths, locks,
publication recovery and checkpoint formats behind domain operations. Routes
share local-origin and bounded-body validation through `shared/http/`.

`shared/ai/contracts.ts` defines neutral interpretation requests and immutable
readiness identities. A future Claude adapter belongs in `shared/ai/server/`
and its provider registration, plus Agent availability/selection metadata. It
does not require changes to profile forms, recovery or persistence. A new profile
field belongs in the model, relevant typed field section and its defaults/mapping;
transport, query scheduling and workspace switching stay unchanged.

Existing caches retain the exact source/key derivation and `text.txt`,
`raw-output.yaml`, `result.yaml` checkpoint formats. Fictional pre-refactor
fixtures fail if interpretation is attempted for reusable output. ESLint import
restrictions enforce feature independence and client/server boundaries.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---
name: jsf-application
description: Add or update job application records in applications_table.csv in a user-provided directory. Track asking salary, application status, interview stages, the next interview, and recruiter conversation notes; ask for missing inputs without choosing business defaults.
---

# JSF Application

Record a candidacy; `ready` records have not yet been submitted. This skill records data locally and does not submit applications or contact recruiters.

## Inputs and confirmation

- Require a destination directory on every invocation. Never substitute the current directory or a previously used directory unless the user explicitly identifies it.
- Determine whether the request adds a record or updates one. Ask if ambiguous.
- For additions, require `vacancy_link`, `company`, `position`, `work_type`, `status`, `salary`, `notes`, `next_interview`, `next_interview_at`, and `interview_stages`. Require `applied_at` for submitted applications; for `ready`, it is empty because submission has not happened.
- `salary` is the candidate's fixed-cash asking range. Ask for the amount/range, currency, pay period, contract type, and pay basis when missing or incomplete; accept explicit “unknown” as an empty salary. Store it as one descriptive string, e.g. `25,000–30,000 PLN/month, B2B, before VAT` or `120,000 EUR/year, gross employment`. Do not substitute advertised pay, an offer, an inferred estimate, or an automatic salary conversion. Advertised pay and offers can go in notes; bonus and equity are separate from fixed cash. Preserve salary on updates unless the user explicitly changes or clears it.
- Ask for omitted required fields in one concise batch and wait. Accept explicit “no notes”, “none”, “unknown”, or “not scheduled” as empty values for notes, interview fields, and unknown application dates. Company, position, work type, status, and vacancy link cannot be empty. Do not interpret silence as an empty value.
- Read the vacancy link when company, position, or work type is missing. Propose extracted facts and get user confirmation before accepting them. If the page is inaccessible or unclear, ask for missing facts; explicit user values are sufficient. Ask about conflicts rather than replacing user values.
- For updates, require the directory, `application_id`, and intended changes. A supplied vacancy link can help find records, but show matching records and have the user identify the application ID before updating. Preserve unspecified fields; do not ask for all fields again. Ask for required facts missing from a legacy record that would prevent the update.
- When a request moves a `ready` record into a submitted state, ask for `applied_at` if not supplied; explicitly unknown is allowed. A change to `ready` must have an empty application date: explain any required clearing before writing.
- After screening, ask for interview stages if still unknown (including when moving into `interviewing`, or when the user says screening finished). Explicit “unknown” is acceptable; remind the user to ask the recruiter about the interview process. Do not block progress because the process is unknown.
- IDs and creation timestamps are generated metadata, the only generated field values. Do not default business fields or infer an application date, interview schedule, or timezone.

## Columns and meanings

New files use this column order:

`application_id, company, position, work_type, status, vacancy_link, notes, created_at, applied_at, next_interview, next_interview_at, interview_stages, salary`

| Column | Meaning and accepted values |
| --- | --- |
| `application_id` | Generated UUID; stable for updates and separate applications to the same vacancy. |
| `company`, `position` | User-provided or confirmed vacancy facts. |
| `work_type` | Exactly `remote`, `hybrid`, or `onsite`; describes location, not contract or vacancy type. |
| `status` | Exactly `ready`, `applied`, `screening`, `interviewing`, `offer`, `rejected`, `withdraw`, or `closed`. |
| `vacancy_link` | The user-provided HTTP(S) vacancy URL, even if expired or inaccessible. |
| `notes` | Free text, including a link or description locating the latest recruiter conversation. |
| `created_at` | Generated UTC creation timestamp for a new record; do not fabricate historical creation times during migration. |
| `applied_at` | User-provided submission date, `YYYY-MM-DD`; blank for ready or explicitly unknown. |
| `next_interview` | Upcoming interview part, e.g. `hr-interview`, `tech-interview-2`, `behavioral-interview`, `leadership-interview`, `ceo-interview`. Employer-specific names are allowed. This is not an application task such as follow-up or submission. |
| `next_interview_at` | `YYYY-MM-DD` or ISO 8601 date and time with an explicit offset, e.g. `2026-10-05T14:00:00+02:00`. Blank when explicitly unscheduled/unknown. Ask for the user's timezone when a time has none; resolve the offset for the supplied date using that timezone, including daylight saving time. Never assume the machine timezone. |
| `interview_stages` | Expected interview sequence, separated by `; `, e.g. `hr-interview; tech-interview-1; tech-interview-2; ceo-interview`. Initially unknown is allowed. This is the plan, not a completion history. |
| `salary` | Candidate's fixed-cash asking range with currency, period, contract type, and pay basis, or blank when explicitly unknown. Ask if omitted on creation. Existing records receive a blank salary during migration. |

`ready` means prepared but not submitted; `applied` means submitted; `screening` means initial review; `interviewing` means the interview process; `offer` means an offer was received; `rejected` means employer rejection; `withdraw` means candidate withdrawal; `closed` means the vacancy ended without an individual rejection. Allow any valid status change; interview sequences vary. Interview stages describe purpose, so a technical assessment by a CTO can be `tech-interview-N`; titles and completion details can go in notes.

## CSV operations

Use [scripts/applications.py](scripts/applications.py) for reading and writing. Resolve its path from this skill directory. It uses Python 3 standard libraries. Respect the workspace's shell wrapper rules (this repository requires `rtk`). Run commands sequentially for a given table.

1. Inspect the destination before writing:
   `rtk python3 <skill-dir>/scripts/applications.py inspect --directory <user-directory>`
2. If an existing file lacks required columns or any record has an empty application ID, show the proposed additions or ID assignments and ask before migration. Explain that existing rows get IDs if absent, newly added business columns remain blank, and historical creation dates remain unknown. Preserve extra columns and existing values. After approval:
   `rtk python3 <skill-dir>/scripts/applications.py migrate --directory <user-directory>`
   Migration creates a backup and reports its path. Do not silently translate legacy statuses or reinterpret existing columns; ask for any necessary record corrections.
3. On add, if the vacancy link already exists, show the matching records and ask whether to update an identified record or create a separate application. Only pass `--allow-duplicate` after the user explicitly chooses a separate record. The helper matches exact stored URLs; inspect for obvious equivalent links differing by tracking parameters and ask if ambiguous.
4. Write a temporary UTF-8 JSON object containing the confirmed fields. Use empty strings for explicitly empty values, strings for dates, and a semicolon-separated string for stages. Never pass `application_id` or `created_at` in this object. On add, include all eleven business columns, including `salary`. On update, include only intended changes.
5. Add:
   `rtk python3 <skill-dir>/scripts/applications.py add --directory <user-directory> --data-file <json-file>`
   Update:
   `rtk python3 <skill-dir>/scripts/applications.py update --directory <user-directory> --application-id <id> --data-file <json-file>`
   Notes append with a newline by default, as agreed. Pass `--notes-mode replace` for an explicit replacement, or `--notes-mode clear` with `"notes": ""` for explicit clearing. Explicit empty appended notes leave existing notes intact. Immutable IDs and creation times are preserved.

The helper creates missing directories and new files only on a successful add. An update to a missing table or unknown ID must stop and ask the user to correct the target; do not create a replacement record. Malformed CSVs or unsupported values must be resolved before retrying. The helper quotes CSV text and writes atomically to avoid partial files; it preserves extra columns and unaffected rows.

Write a complete explicit request immediately after any necessary fact confirmations, duplicate choice, or migration approval. Do not add a routine final approval prompt. Report the absolute CSV path, application ID, and fields added/changed, plus any relevant reminder to learn the interview stages. Report success only after the helper succeeds.

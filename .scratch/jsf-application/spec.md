# jsf-application

Status: ready-for-agent

## Original request (historical)

- Create a skill named `jsf-application`.
- Accept a vacancy link, a destination directory, and application data whose full set is to be decided during the design interview.
- Store records in `applications_table.csv` within the user-provided directory.
- Create the directory and CSV if absent.
- No default parameter values: ask the user for missing required parameters.
- Requested columns: `company`, `position`, `work_type`, `status`, `vacancy_link`, `notes`.
- Requested work types: `remote`, `hybrid`, `onsite`.
- Requested statuses: `ready`, `applied`, `screening`, `hr-interview`, `tech-interview-1` through `tech-interview-10`, `offer`, `rejected`, `withdraw`, `closed`.

## Design interview

### Settled decisions — round 1

- Support adding records and updating existing records.
- Extract proposed company, position, and work location arrangement from the vacancy; require user confirmation before accepting them.
- Ask for destination directory and status; do not silently select either.
- Ask for notes when omitted; an explicit "no notes" permits an empty cell. Notes may include references to the latest recruiter conversation.
- Add `application_id`, `created_at`, and `applied_at` to the requested columns. IDs and creation timestamps may be generated as metadata. The user supplies the application date when applicable.
- `ready`: prepared but not submitted; `applied`: submitted; `screening`: initial application review; `hr-interview`: recruiter or HR interview.
- `rejected`: employer rejection; `withdraw`: candidate withdrawal; `closed`: vacancy ended without an individual rejection.
- Additional behavioral and leadership interview statuses are requested; their names and definitions remain open.

### Settled decisions — round 2

- Add `behavioral-interview` and `leadership-interview`; classify interviews by purpose. Technical assessments by a CTO use `tech-interview-N`; interviewer titles belong in notes.
- When an added vacancy link matches an existing record, show the existing record and ask whether to update it or create a separate application. Do not choose automatically.
- Identify existing records by `application_id` for updates.
- Updates require the destination directory, record identifier, and intended changes. Preserve fields not included in the update.
- Append notes unless the user explicitly requests replacement or clearing.
- Ask for `applied_at` for submitted applications. An explicit "unknown" permits an empty cell; `ready` records have an empty application date. Use `YYYY-MM-DD`.
- Preserve extra columns in existing CSV files. Explain missing required columns and ask before migrating the file.
- If a vacancy is inaccessible or incomplete, ask for missing facts and accept explicit user values. Require company, position, work type, and vacancy link before adding a record.

### Settled decisions — round 3

- Replace the detailed interview statuses with exactly: `ready`, `applied`, `screening`, `interviewing`, `offer`, `rejected`, `withdraw`, `closed`.
- Add `next_step` and `next_step_at` for the upcoming action and its scheduled date; for example, `tech-interview-2` and its date.
- Add `stages` for the vacancy's interview process. It may initially be empty; the user should ask about the process during screening so it can be populated afterward. Enforcement and handling of unknown stages remain open.
- Earlier detailed interview labels are no longer valid application statuses. Their use in next steps and stage lists remains to be defined.
- Install at `.agents/skills/jsf-application/` in this repository.
- Write immediately for complete explicit requests after extracted facts have been confirmed. Ask for missing information, duplicate resolution, and migration approval when needed.
- Report the destination file path, application ID, and fields added or changed after a successful write.
- Python 3 helper scripts are authorized when they simplify operations.

### Settled decisions — round 4

- The stage list is an ordered list of expected interview parts, separated by semicolons. Employer-specific interview names are permitted.
- The next-step field describes the next interview part of the hiring process, such as `hr-interview`, `tech-interview-2`, or `ceo-interview`. It does not describe application tasks such as follow-up or submission.
- Accept a date (`YYYY-MM-DD`) or a timestamp with a timezone offset for the next interview. Ask for timezone information when a time is supplied without it; do not infer a timezone. Explicit "not scheduled" permits an empty date field.
- Ask for interview stages after screening; accept explicit "unknown" and remind the user to ask the recruiter. Unknown stages do not block progress to interviewing.
- On creation, ask for omitted new fields, accepting explicit "unknown" or "none" as empty values where appropriate. On updates, preserve unspecified fields.

### Confirmed final naming

- `next_step` → `next_interview`.
- `next_step_at` → `next_interview_at`.
- `stages` → `interview_stages`.
- Final column order: `application_id`, `company`, `position`, `work_type`, `status`, `vacancy_link`, `notes`, `created_at`, `applied_at`, `next_interview`, `next_interview_at`, `interview_stages`, `salary`.
- The later [salary extension](../jsf-application-salary/spec.md) adds the candidate's asking range as one descriptive column. Ask when omitted on creation, accept explicit unknown as blank, and preserve it on unrelated updates and during migration.

The user confirmed the complete design and final column names. Implementation is authorized.

## Implementation

Completed at `.agents/skills/jsf-application/`:

- `SKILL.md` defines input collection, confirmed vacancy extraction, current status vocabulary, interview fields, duplicate choices, updates, and migration approval.
- `scripts/applications.py` provides inspect/add/update/migrate commands using only the Python 3 standard library. Writes are atomic; migration preserves extra columns and produces a backup. New IDs and creation timestamps are generated; historical creation dates are not invented.
- `scripts/test_applications.py` is a runnable check using temporary directories. It verifies directory/file creation, required inputs, multiline/Unicode CSV text, duplicate resolution, status/date/timezone validation, update preservation, note append/replace/clear, separate application IDs, migration backup and extra-column preservation, and rejection of malformed CSVs without changing the file.

Validation: the application CSV checks passed, as did YAML frontmatter/scaffold validation using Ruby's YAML parser and `git diff --check`. The bundled skill-creator validator could not run because the available Python interpreters lack PyYAML; no runtime dependency was added to the skill.

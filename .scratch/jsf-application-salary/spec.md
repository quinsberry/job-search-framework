# Salary in application records

Status: ready-for-agent

## Requested change

Add a salary column to `applications_table.csv` and update the `jsf-application` skill and its CSV helper accordingly.

## Settled decisions

- `salary` stores the candidate's fixed-cash asking range, not advertised vacancy pay or an employer offer. Advertised pay and offers can be recorded in notes.
- Use a single descriptive `salary` column containing the amount/range, currency, pay period, contract type, and pay basis; for example, `25,000–30,000 PLN/month, B2B, before VAT`.
- Ask when salary is omitted on creation. Accept explicit "unknown" as an empty cell. Preserve unspecified salary on updates.
- Add the column with blank values for existing records during migration; do not invent asking ranges.

## Confirmation

- The user confirmed the completed design and implementation authorization.
- The workspace CSV was absent. The user approved recreating it with the previously recorded Redpanda application and an empty salary. Preserve the known application ID; the historical creation timestamp is unknown and must remain empty.

Append `salary` to the existing column order so prior columns retain their positions. Existing application records must be preserved.

## Implementation and verification

- Updated `jsf-application/SKILL.md` to collect and explain salary; additions require eleven business fields, and updates preserve salary unless explicitly changed or cleared.
- Added `salary` to the helper's schema. The existing migration operation adds a blank salary, retains all existing values and IDs, and creates a backup.
- Recreated workspace `applications_table.csv` with the confirmed Redpanda record, original ID `94976e53-d3fb-4915-bb8b-7ec1f3b9cad6`, empty salary, and unknown historical creation time left empty. Readback showed thirteen columns and no missing required columns.
- Python CSV checks passed, including missing salary rejection, descriptive salary round trips, preservation on unrelated updates, explicit salary change/clear, and migration of the previous schema without historical changes. YAML frontmatter/scaffold checks and `git diff --check` passed.

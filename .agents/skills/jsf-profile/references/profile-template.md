# Candidate profile template

This is the output standard for CV imports, not a candidate profile to copy verbatim. The single fenced block defines the layout. Experience, Projects, Education and Certifications contain repeatable record patterns. Identity is one field block; Skills and Languages use compact bullet lists. Examples are instructional; they are never facts or defaults. Python supplies the evidence marker, stable record IDs and supported values.

- Keep all seven sections, including empty ones. Create records only for supported entries; never create sample jobs, skills or qualifications.
- Show known fields and missing expected fields. Omit unknown optional fields; their examples remain available here and in UI help. Keep all seven section headings.
- Lists: Links, Achievements, Technologies and Outcomes. Use indented bullets for known values and `Unknown` for an unknown list. All other fields are text.
- Dates retain source precision (`2021`, `2021-06`, `2021-06-15`). Use `present` only for explicitly ongoing work. Language levels and quantified results require source support. Skill proficiency/context fields are not part of the active profile.
- Desired roles, pay and work arrangements belong in search-config.yml. Sources/evidence remain in supporting files.
- Example comments and layout directives are removed when rendering a real profile; the UI exposes field help. Skills render as `- React`; languages as `- English — C1` or `- Polish` when no level is stated. Do not invent missing levels.

```markdown
# Candidate profile

{{evidence_marker}}

{{instructions}}

## Identity

<!-- Layout: identity -->

<!-- Example: "Alex Example" -->
- **Full Name:** Unknown
<!-- Example: "Warsaw, Poland" -->
- **Location:** Unknown
<!-- Example: "alex@example.com" -->
- **Email:** Unknown
<!-- Example: "+48 000 000 000" -->
- **Phone:** Unknown
<!-- Example: ["https://example.com", "https://github.com/example"] -->
- **Links:** Unknown
<!-- Example: "Frontend engineer building accessible web applications." -->
- **Summary:** Unknown

## Experience

### {{title}} <!-- id: {{id}} -->

<!-- Example: "Example Company" -->
- **Company:** Unknown
<!-- Example: "Frontend Engineer" -->
- **Role:** Unknown
<!-- Example: "2021-06" -->
- **Start Date:** Unknown
<!-- Example: "present" -->
- **End Date:** Unknown
<!-- Example: "Krakow, Poland" -->
- **Location:** Unknown
<!-- Example: ["Built an accessible checkout", "Reduced bundle size by 20%"] -->
- **Achievements:** Unknown
<!-- Example: ["React", "TypeScript"] -->
- **Technologies:** Unknown

## Skills

<!-- Layout: skills -->

<!-- Example: "React" -->
- **Name:** Unknown

## Projects

### {{title}} <!-- id: {{id}} -->

<!-- Example: "Component library" -->
- **Name:** Unknown
<!-- Example: "Maintainer" -->
- **Role:** Unknown
<!-- Example: "Reusable accessible interface components." -->
- **Description:** Unknown
<!-- Example: ["TypeScript", "Storybook"] -->
- **Technologies:** Unknown
<!-- Example: ["Published reusable components", "Documented accessibility behavior"] -->
- **Outcomes:** Unknown
<!-- Example: "https://github.com/example/components" -->
- **URL:** Unknown

## Education

### {{title}} <!-- id: {{id}} -->

<!-- Example: "Example University" -->
- **Institution:** Unknown
<!-- Example: "Bachelor of Science" -->
- **Qualification:** Unknown
<!-- Example: "Computer Science" -->
- **Field:** Unknown
<!-- Example: "2016" -->
- **Start Date:** Unknown
<!-- Example: "2020" -->
- **End Date:** Unknown

## Languages

<!-- Layout: languages -->

<!-- Example: "English" -->
- **Name:** Unknown
<!-- Example: "C1" -->
- **Level:** Unknown

## Certifications

### {{title}} <!-- id: {{id}} -->

<!-- Example: "AWS Certified Developer – Associate" -->
- **Name:** Unknown
<!-- Example: "Amazon Web Services" -->
- **Issuer:** Unknown
<!-- Example: "2024-05" -->
- **Date:** Unknown
<!-- Example: "2027-05" -->
- **Expiry Date:** Unknown

```

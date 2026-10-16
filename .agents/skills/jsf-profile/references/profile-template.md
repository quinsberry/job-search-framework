# Candidate profile template

This is the output standard for CV imports, not a candidate profile to copy verbatim. The single fenced block defines the layout. Each section contains one repeatable record pattern. Examples are instructional; they are never facts or defaults. Python supplies the evidence marker, stable record IDs and supported values.

- Keep all seven sections, including empty ones. Create records only for supported entries; never create sample jobs, skills or qualifications.
- Show every field of an actual record. Missing values are `Unknown`; optional unknowns do not require clarification.
- Lists: Links, Achievements, Technologies and Outcomes. Use indented bullets for known values and `Unknown` for an unknown list. All other fields are text.
- Dates retain source precision (`2021`, `2021-06`, `2021-06-15`). Use `present` only for explicitly ongoing work. Levels and quantified results require source support.
- Desired roles, pay and work arrangements belong in search-config.yml. Sources/evidence remain in supporting files.
- Example comments are removed when rendering a real profile; the UI exposes them as field help.

```markdown
# Candidate profile

{{evidence_marker}}

{{instructions}}

## Identity

### {{title}} <!-- id: {{id}} -->

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

### {{title}} <!-- id: {{id}} -->

<!-- Example: "React" -->
- **Name:** Unknown
<!-- Example: "Advanced" -->
- **Level:** Unknown
<!-- Example: "Used to build a customer dashboard at Example Company." -->
- **Context:** Unknown

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

### {{title}} <!-- id: {{id}} -->

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

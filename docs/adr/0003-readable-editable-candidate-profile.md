# Use one readable Markdown candidate profile

The user chose candidate/profile.md as the single authoritative professional profile, replacing canonical YAML plus a generated Markdown view. Search preferences remain separate YAML. This supersedes the previous candidate storage convention, while retaining versioned JSON exchange contracts and specialist ownership.

The profile uses defined Markdown sections, stable record IDs and field labels so Python can parse and validate direct edits without AI. Changed claims are explicit user corrections; unchanged facts keep their source evidence. Detailed provenance, source snapshots and historical conflicts live in supporting metadata referenced by a digest, without duplicate current fact values. Supporting files are written before atomic Markdown publication.

Legacy YAML remains readable until the first successful profile save. Saving backs up the previous YAML and generated view, publishes Markdown, then removes the old active artifacts. Opening or exporting never migrates. Imported CVs remain reusable workspace sources even if an intake draft is cancelled.

The UI invokes these owner operations. Its four setup points are ordered for guidance, while profile and preferences editors/drafts remain independent. An AI CLI (Codex or Claude Code) is required for interpretation and discovery, not ordinary manual edits.

The profile owner's profile-template.md defines the output layout and examples. CV interpretation supplies supported facts into this structure. All seven sections remain visible; every actual record shows all fields, with Unknown for absent facts. Empty sections never instantiate fictional records. Python validates template/schema consistency and scalar/list shapes. Examples are available as help without entering candidate facts, and optional unknown fields do not become readiness warnings.

The compact profile decision supersedes showing every optional field: omit unknown optional facts, keep expected unknowns and all seven sections. Identity uses one field block; skills use names only; languages use names with optional explicitly stated proficiency. Repeated experience/project/qualification records retain IDs and dates. Old Markdown/YAML is converted in memory without writes; the next save backs up original files and evidence before publishing the current format. Retired skill level/context fields exist only in the one-time backup, not the active schema or exports.

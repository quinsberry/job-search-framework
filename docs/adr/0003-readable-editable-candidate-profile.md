# Use one readable Markdown candidate profile

The user chose candidate/profile.md as the single authoritative professional profile, replacing canonical YAML plus a generated Markdown view. Search preferences remain separate YAML. This supersedes the previous candidate storage convention, while retaining versioned JSON exchange contracts and specialist ownership.

The profile uses defined Markdown sections, stable record IDs and field labels so Python can parse and validate direct edits without AI. Changed claims are explicit user corrections; unchanged facts keep their source evidence. Detailed provenance, source snapshots and historical conflicts live in supporting metadata referenced by a digest, without duplicate current fact values. Supporting files are written before atomic Markdown publication.

Legacy YAML remains readable until the first successful profile save. Saving backs up the previous YAML and generated view, publishes Markdown, then removes the old active artifacts. Opening or exporting never migrates. Imported CVs remain reusable workspace sources even if an intake draft is cancelled.

The UI invokes these owner operations. Its four setup points are ordered for guidance, while profile and preferences editors/drafts remain independent. Codex is required for interpretation and discovery, not ordinary manual edits.

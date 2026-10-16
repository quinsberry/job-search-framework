# Profile contracts

## Python read interface

Import `from jsf_profile import profile` after adding this skill's `scripts` directory to the Python path. `profile.export(workspace)` validates current YAML and returns the same versioned summary as CLI `export`; a missing profile is an error. `profile.expertise(workspace)` returns the current validated skills, experience, projects and languages records as professional context, without deriving mandatory search filters. Both are read-only; no JSON cache is created. Validation and I/O errors propagate to callers. Search preferences use `jsf_profile.search_config.export(workspace)` and require the declared sibling `jsf-search`.

## Source extraction

`extract --source CV.pdf|CV.md [--kind cv|user]` returns JSON:

```json
{
  "schema_version": 1,
  "outcome": "ready",
  "source": {
    "id": "<64-character SHA-256 digest>",
    "name": "CV.md",
    "kind": "cv",
    "format": "md",
    "pages": [{"page": 1, "text": "Alex Example\nFrontend Engineer at Acme, 2020–present. React and TypeScript."}],
    "issues": []
  }
}
```

Source identity hashes kind plus original bytes; imports have no timestamps. PDF pages retain physical page numbers. Markdown is one logical page. `user` sources are Markdown records of explicit user statements, not inferred corrections. Preserve returned source objects; quotes are verified against their page text. Renaming an identical file retains identity; the first recorded name remains.

Extraction also supplies an absolute `path` for collision protection. Source CVs must not occupy generated artifact paths such as `candidate/README.md`. Canonical exports preserve the first recorded source path; replay does not need that file to exist.

Outcomes: `ready` means usable text without reported extraction issues; `partial` means some text is usable but extraction issues remain; `needs_clarification` means no usable text. This is not a claim about the completeness of interpreted facts. Dependencies are [pypdf](https://pypdf.readthedocs.io/en/stable/user/extract-text.html) for text-layer extraction and [PyYAML](https://pyyaml.org/wiki/PyYAMLDocumentation) for safely loading/dumping YAML. Scanned PDFs need readable text supplied separately; OCR is outside this version.

## Changes input

```json
{
  "schema_version": 1,
  "sources": ["<source objects returned by extraction, not strings>"],
  "records": [
    {
      "id": "identity",
      "section": "identity",
      "facts": {
        "full_name": {
          "value": "Alex Example",
          "evidence": [{"source_id": "<source digest>", "page": 1, "quote": "Alex Example"}]
        }
      }
    },
    {
      "id": "experience-acme-frontend-2020",
      "section": "experience",
      "facts": {
        "company": {"value": "Acme", "evidence": [{"source_id": "<source digest>", "page": 1, "quote": "Frontend Engineer at Acme"}]},
        "role": {"value": "Frontend Engineer", "evidence": [{"source_id": "<source digest>", "page": 1, "quote": "Frontend Engineer at Acme"}]},
        "start_date": {"value": "2020", "evidence": [{"source_id": "<source digest>", "page": 1, "quote": "2020–present"}]},
        "end_date": {"value": "present", "evidence": [{"source_id": "<source digest>", "page": 1, "quote": "2020–present"}]},
        "technologies": {"value": ["React", "TypeScript"], "evidence": [{"source_id": "<source digest>", "page": 1, "quote": "React and TypeScript"}]}
      }
    }
  ],
  "issues": [],
  "resolved_issues": []
}
```

Source objects can be omitted from this list when evidence references already stored sources. Facts are strings, nonempty lists of strings, or null. Quote dates in YAML to preserve their precision and prevent implicit date conversion. A non-null fact requires evidence; an unknown uses null and may have empty evidence. Values and quotes may retain the original CV language. Do not translate names or manufacture a level.

Supported sections and fields:

| Section | Fields | Expected facts (missing ones are reported) |
| --- | --- | --- |
| identity | full_name, location, email, phone, links, summary | full_name |
| experience | company, role, start_date, end_date, location, achievements, technologies | company, role, start_date, end_date |
| skills | name, level, context | name, level |
| projects | name, role, description, technologies, outcomes, url | name, description |
| education | institution, qualification, field, start_date, end_date | institution, qualification |
| languages | name, level | name, level |
| certifications | name, issuer, date, expiry_date | name, issuer |

Records use unique stable lowercase slugs. There is at most one identity record. Reuse existing IDs when importing the same real-world item; IDs never need changing because a factual claim changes. Automatic fuzzy matching of employment/project identities is not attempted. The interpreting skill resolves correspondence or marks it ambiguous.

Quotes match after case/whitespace normalization, on the specified page only. Quotations establish textual support, not proof that a interpreted value is semantically correct; that remains the interpretation stage's responsibility.

## Corrections and conflicts

A patch fact with `correction: true` must cite explicit user statements. It replaces that fact, can clear it with null, and resolves conflicts for that record/field. Canonical data stores `user_corrected: true` to prevent later CVs from silently undoing it. Mere CV omissions or null unknowns never clear known facts. An omitted record never removes earlier history.

Non-correction lists accumulate supported items, retaining earlier omitted entries; avoid adding semantically conflicting bullets, such as two different metrics for the same achievement. Mark such ambiguities or request a user correction. A change to a user-corrected list also requires clarification or explicit correction.

Different scalar values create conflicts. The original accepted value remains, with its proposed alternative and both sets of evidence. Repeated proposals do not duplicate conflicts. A later correction can explicitly choose either value or another supported value. Missing information and independent conflicts do not prevent saving other supported facts.

`issues` adds free-text extraction ambiguities. `resolved_issues` removes exact previously recorded issues and requires a newly supplied user-statement source. Expected missing facts are derived automatically and disappear when supported facts are supplied.

## Canonical profile and execution result

`candidate/profile.yaml` contains:

```yaml
schema_version: 1
sources: {}       # source ID -> extracted source snapshot (immutable history)
records: []       # accepted facts, using the record contract
issues: []        # unresolved free-text extraction ambiguities
conflicts: []     # conflicting proposals; never overwrite accepted facts implicitly
```

Sources are embedded so exports can validate quotes without access to the original CV. The supplied CV remains unchanged. Keep source snapshots, record IDs and correction provenance intact when editing YAML. Prefer explicit corrections through the skill for factual changes; regenerate views after valid canonical edits.

`plan` returns an execution result plus `base_revision`. It writes nothing. The execution result is:

- `schema_version: 1`.
- `outcome`: `ready`, `partial`, or `needs_clarification`.
- `revision`: digest of canonical profile content.
- `profile`: full canonical data.
- `unknowns`: missing expected facts or explicitly null facts.
- `conflicts`: unresolved alternatives with `id`, `record_id`, `field`, `existing` and `incoming` facts.
- `issues`: unresolved extraction notes.

`partial` is a usable nonempty profile with unknowns/conflicts/issues. `ready` means none of these are currently reported, not that every optional fact is known. Downstream consumers must inspect the facts and conflicts relevant to their task. A retained value under dispute is not an undisputed fact.

`apply` reads current canonical YAML, verifies the plan's base revision and proposed revision, checks preservation, then writes profile YAML and README. Repeat imports and view rendering are deterministic; applying a stale plan is a validation error, so re-plan rather than force it. New profile creation with zero supported facts is rejected without creating candidate artifacts.

There is no saved `candidate/profile.json`. `export` validates current YAML and emits the execution result to stdout without writes, so manual YAML edits cannot leave an authoritative JSON cache behind. Consumers must export afresh. `candidate/README.md` is a generated readable presentation, including provenance, unknown fields and conflict flags; regenerate it with `render` after valid manual edits. `apply` and `render` remove the legacy JSON cache, but read-only export does not. Neither export nor rendering reads the clock or reinterprets the CV.

Each artifact is written atomically, but the replacements are not a filesystem-wide transaction. Canonical YAML is written before README. On a write failure, use canonical YAML as the authority and regenerate README before treating them as consistent. Original CV files and unrelated workspace files are never modified.

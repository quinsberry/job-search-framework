# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `Status:` line near the top of each issue file; see `triage-labels.md` for the role strings
- Comments and conversation history append under `## Comments`

## Skill operations

When a skill says "publish to the issue tracker," create a file under `.scratch/<feature-slug>/`. When it says "fetch the relevant ticket," read the referenced issue file.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Each child records `Type:` (`research`, `prototype`, `grilling`, or `task`) and `Status:` (`claimed` or `resolved`)
- Record dependencies as `Blocked by: NN, NN`; a ticket is unblocked when every listed ticket is resolved
- Find the frontier by scanning for open, unblocked, unclaimed tickets; take the lowest number first
- Claim by setting `Status: claimed` before work
- Resolve by adding `## Answer`, setting `Status: resolved`, and adding a summary with a link to the map's Decisions-so-far section

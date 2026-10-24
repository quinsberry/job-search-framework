# Stored-format fixtures

Golden files for `stored-format.test.ts`. All data is fictional.

- `applications-v3.json` and `inspected.jsonl` were written by the current `ApplicationList` and `SearchMemory`.
- `applications-v2.json` is the same list as the v2 writer produced it, reconstructed from the schema at commit `20ebeb4` (the last commit that wrote v2, after it gained `deleted`). Parsing it with that commit's `applicationsFileSchema` and writing it as that commit's `ApplicationList` did reproduces the file byte for byte. It holds only values v2 can express, so it loads equal to the v3 fixture.

A deliberate format change edits these files in the same commit, with the reason in the commit message.

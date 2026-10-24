# Matching accuracy evaluation tool

Status: ready-for-agent
Blocked by: [decision model identity](../decision-model-identity/spec.md) (architecture review issue 14)

Source: [architecture review issue 01](../architecture-review/issues/01-matching-accuracy-evaluation.md) and its triage decisions (2026-10-24). The human follow-up (labelling, baseline, band calibration) is [issue 35](../architecture-review/issues/35-matching-accuracy-baseline.md).

## Problem Statement

As a job seeker, I trust the search workflow to tell me which vacancies are qualifying vacancies, which are rejected and which are vacancies needing clarification. Nobody knows how often its Match outcome agrees with what I would decide myself. Matching's probability bands (0.2 and 0.8) and the ±10-point skill-coverage band were chosen without measurement. If they are wrong, I miss good vacancies or wade through bad ones, and there's no way to find out short of judging every vacancy by hand.

## Solution

An opt-in tool, separate from the app and from the test suite, with two commands.

- **Capture** takes a vacancy URL and my verdict: the expected Match outcome, optionally the expected result for some criteria, and a note. It fetches the vacancy from its search source and saves a snapshot with my label in a private folder of my workspace.
- **Run** evaluates every saved vacancy with real matching, within a cost cap I set, against a snapshot of my matching inputs. It writes a report saying how often matching agreed with me, where and why it disagreed, and what it cost.

Nothing I label or measure leaves my workspace unless I choose to publish aggregate numbers.

## User Stories

1. As a job seeker, I want to save a vacancy for evaluation by giving its URL, so that I don't have to copy its text by hand.
2. As a job seeker, I want to record my own expected Match outcome when I save a vacancy, so that matching can be measured against my judgement.
3. As a job seeker, I want to optionally record the expected result for specific criteria, such as advertised compensation or work location arrangement, so that I can see which criteria matching gets wrong.
4. As a job seeker, I want to add a note explaining my verdict, so that I can later tell my own labelling mistakes from matching mistakes.
5. As a job seeker, I want to label from the command line only, so that I never have to edit data files.
6. As a job seeker, I want the saved vacancy to be a snapshot, so that the evaluation still works after the listing closes or changes.
7. As a job seeker, I want a URL that no search source recognises to be refused with a clear message, so that I don't save something the tool can't evaluate.
8. As a job seeker, I want saving the same vacancy twice to be refused unless I ask to relabel, so that I don't overwrite a label by accident.
9. As a job seeker, I want relabelling to replace only my label and keep the snapshot, so that changing my mind doesn't refetch or change the evidence.
10. As a job seeker, I want my labels judged against a snapshot of my search configuration and skills, so that later profile changes don't silently invalidate earlier labels.
11. As a job seeker, I want the run to warn me when my current saved configuration differs from the snapshot, so that I know the results describe the candidate I labelled for.
12. As a job seeker, I want to set a maximum spend for a run, so that an evaluation never costs more than I agreed to.
13. As a job seeker, I want calls of unknown cost to stop the run unless I allow them, so that unpriced calls can't bypass my cap.
14. As a job seeker, I want a dry run with a fake decision model, so that I can check my set and the report at no cost.
15. As a job seeker, I want a vacancy that fails to evaluate to be listed as an error rather than counted as a disagreement, so that outages don't distort accuracy.
16. As a job seeker, I want a model outage, a rate limit or reaching my cap to stop the run but still give me a partial report, so that money already spent isn't wasted.
17. As a job seeker, I want the report to show how often matching agreed with me overall and excluding needs-clarification, so that I see both the strict and the lenient picture.
18. As a job seeker, I want a confusion matrix of the three Match outcomes, so that I see whether matching is too strict or too lenient.
19. As a job seeker, I want per-criterion confusion for the criteria I labelled, so that I know which checks or questions to fix.
20. As a job seeker, I want one row per vacancy showing expected versus actual outcome, the differing criteria and my note, so that I can review disagreements one by one.
21. As a job seeker, I want the report to show total cost and the number of unpriced calls, so that I know what the measurement cost.
22. As a job seeker, I want the report to name the matching rules version and decision model identity, so that I can compare reports across versions and models.
23. As a job seeker, I want the report to flag when the decision model that answered differs from the one requested, so that I don't attribute results to the wrong model.
24. As a job seeker, I want reports saved with a timestamp in my workspace, both readable and machine-readable, so that I can keep a history and compare runs.
25. As a job seeker, I want my vacancies, labels, profile snapshot and reports never committed to the repository, so that private data and publisher content stay private.
26. As a job seeker, I want both commands to require an explicit workspace, so that the tool never touches the wrong folder.
27. As the maintainer, I want the evaluation never to run as part of the test suite or CI, so that those stay deterministic, offline and free.
28. As the maintainer, I want the tool's scoring and failure handling covered by offline tests, so that a wrong confusion matrix can't mislead calibration.
29. As the maintainer, I want a new search source to support capture by implementing one optional capability, so that the tool extends without changes to the tool itself.
30. As the maintainer, I want the evaluation logic to respect the architecture boundaries, so that the tool doesn't become a back door around module rules.
31. As the maintainer, I want matching used exactly as the search workflow uses it, so that the measurement reflects production behaviour.

## Implementation Decisions

- **Split.** This spec is the tool only. Building the real set, recording the baseline, publishing aggregates and changing bands or the matching rules version belong to issue 35.
- **Two operations in an evaluation module** on the server side next to matching, wherever matching lives (issue 03 moves it to the domain layer):
  - **capture**: workspace, URL, label, and an optional relabel flag;
  - **run**: workspace, cost cap, allow-unpriced flag, and dry-run flag.

  Both receive their dependencies injected, the same pattern as the search workflow:
  - search sources, for resolving URLs and fetching details;
  - the decision model;
  - the clock.
- **Entry commands.** Two thin command-line entry points outside the source tree parse flags and call the operations. They have their own lint allowance and are named so that the test runner never collects them. CI never runs them.
- **Search source capability.** The search source contract gains an optional "job reference from URL". The registry resolves a URL through the sources that implement it, and an unclaimed URL is refused. LinkedIn implements it for its job view URLs.
- **Storage.** An evaluation folder in the workspace holds:
  - one JSON file per vacancy, containing a version, the job detail snapshot validated by the existing job detail schema, and the label;
  - a set file holding the candidate snapshot;
  - timestamped reports.

  Files are written only by the tool, one file per write, so no lock is needed and a damaged file affects one vacancy.
- **Label shape.** A required expected Match outcome (match, no-match, needs-clarification), optional expected results keyed by criterion name, and an optional note.
- **Candidate snapshot.** The search configuration and the profile skills that matching consumes, taken from the workspace's saved, published versions (never drafts) on first capture. The run uses the snapshot, and reports a difference from the current saved configuration as a warning.
- **Matching.** Matching runs unchanged with the production decision model (or a fake in dry run), with the same inputs the search workflow passes.
- **Cost cap.** Reported cost is summed. Before each decision model call, the run stops if the sum has reached the cap. An unpriced call counts as reaching the cap unless unpriced calls are allowed. Calls are counted the same priced/unpriced way as in the search run summary.
- **Failures.** This follows the search workflow's failure policy (ADR 0009). A per-vacancy evaluation error becomes an error row and is excluded from agreement. A model outage, rate limiting or the cap stops the run, and the partial report is still written.
- **Report.** Timestamped Markdown and JSON in the workspace, containing:
  - the matching rules version and decision model identity (from issue 14);
  - the decision model reported by responses, with any mismatch flagged;
  - a three-outcome confusion matrix;
  - agreement overall and excluding needs-clarification;
  - per-criterion confusion for labelled criteria;
  - per-vacancy rows (expected, actual, differing criteria, note, or error);
  - total cost and the unpriced call count;
  - snapshot drift warnings.
- **Glossary.** No change: "expected outcome" and "labelled set" are tool vocabulary, not domain language.

## Testing Decisions

- Good tests drive the two operations the way the commands do and assert on what the job seeker sees: stored files, refusal messages and report contents. They never assert on internal scoring helpers.
- **Seam 1 (new): the evaluation module's capture and run operations**, with the injected fake search source, fake decision model and fixed clock, over a committed fictional sample set. They cover:
  - capture stores a validated snapshot and label;
  - an unknown URL and an unflagged re-capture are refused;
  - relabel changes only the label;
  - the run yields the expected confusion matrix, agreement figures, per-criterion confusion and rows;
  - a per-vacancy error becomes an error row excluded from agreement;
  - an outage stops the run with a partial report;
  - the cost cap stops before exceeding it;
  - unpriced calls stop the run unless allowed;
  - snapshot drift and model mismatch are flagged;
  - dry run makes no paid calls.
- **Seam 2 (existing): the LinkedIn adapter tests with committed HTML fixtures.** Job view URLs resolve to a job reference, and foreign URLs are not claimed.
- Prior art: the search workflow tests (injected dependencies, fake models and sources, temporary workspace), the LinkedIn provider tests and fixtures, and the multi-source fixture.
- Not tested: the command entry points (flag parsing only). Live runs are never part of the test suite or CI.

## Out of Scope

- Collecting and labelling the real set, running the baseline, publishing aggregates, changing bands or the matching rules version (issue 35).
- Any UI for capture, labelling or reports.
- Changing matching behaviour or the decision model.
- Comparing several decision models in one run.
- Committing real vacancy text, labels, the profile snapshot or reports.

## Further Notes

- Blocked by the decision model identity work (issue 14), so every report names the model it measured.
- A band change made after issue 35's baseline must bump the matching rules version, which re-judges stored rejections on the next search run.

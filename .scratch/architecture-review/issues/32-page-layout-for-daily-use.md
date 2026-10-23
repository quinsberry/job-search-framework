# 32 — Page layout for daily use: applications first once setup is done

Status: needs-triage
Type: grilling

`app/workspace-content.tsx` renders one long page in setup order: Workspace, Agent, Candidate Profile, Search Preferences, Applications. That order suits the first visit. Afterwards the daily work (running searches, triaging and updating applications) happens in the last card, below two large editors, so the user scrolls past them every time.

Options to decide between with the user:

- collapse the profile and preferences cards once they have published data, showing a one-line summary and an Edit action;
- move Applications to the top once preferences exist;
- split into views (for example Setup and Applications tabs) while keeping one route.

Constraints: unsaved drafts must still flush before leaving an editor view, using the same mechanism as workspace switching (issue 24), and the recovery status of a collapsed editor with a pending or conflicted draft must stay visible.

Outcome: a chosen layout recorded as an answer here, then a follow-up task.

## Comments

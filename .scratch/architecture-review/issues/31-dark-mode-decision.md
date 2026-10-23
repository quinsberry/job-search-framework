# 31 — Activate or remove the dark theme

Status: needs-triage
Type: task

`app/globals.css` defines a full `.dark` token set and a `dark` custom variant, but nothing ever applies the `dark` class: there is no theme toggle, no `prefers-color-scheme` handling and no theme library. The dark styles are dead code, and users with a dark system theme get the light UI.

Pick one:

- **Follow the system theme** (recommended, smallest): apply `.dark` from `prefers-color-scheme` without a flash on load, for example by switching the custom variant to the media query, and check contrast of the existing dark tokens, including the table, toasts, badges and destructive text.
- **Add a toggle** with system as the default, persisted like the workspace.
- **Remove** the `.dark` tokens and variant.

Done when the chosen option ships and the UI is checked in both themes, or the dead styles are removed.

## Comments

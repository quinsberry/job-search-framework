# 15 — Make the Agent provider list cover every registered AI provider

Status: needs-triage
Type: task

Adding an AI provider takes four edits: the adapter in `shared/ai/server/`, its ID in `providerSchema` (`shared/ai/contracts.ts`), the server registry in `shared/ai/server/providers.ts`, and a label/icon entry in the `providers` array in `modules/agent/agent-section.tsx`. The server registry is checked against the enum, but the UI array is not: it is typed as a list whose entries may use any `Provider`, so a provider can be registered but never offered in the Agent section, and nothing fails.

The UI cannot import the server registry, so the fix is a compile-time coverage check on the client side rather than deriving the list from the registry:

- Key the UI metadata by provider ID, for example `const providerOptions = { codex: { label, icon }, claude: { label, icon } } satisfies Record<Provider, ProviderOption>`, and build the dropdown from it. Adding an ID to `providerSchema` then fails typecheck until the UI entry exists.
- Keep the existing disabled "coming soon" entries as a separate list, if still wanted.

Update the README's "Adding an AI provider" steps. Done when a missing UI entry is a type error and tests, typecheck and lint pass.

## Comments

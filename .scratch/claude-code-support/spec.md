# Support Claude Code alongside Codex

Status: resolved

## Request

The framework was built for Codex; the README listed Claude integration as deferred. Support Claude Code both as the agent using the skills and as the AI CLI behind the local app.

## Confirmed implementation facts

All AI calls went through `jsf_workflow/codex_bridge.py` (`codex exec` with an output schema, read-only sandbox, ignored user config, ChatGPT login only). Callers were `setup_sessions` (guided profile), `workflow.find_jobs` (annotation batches and cache version), `app/server.py` and `app/readiness.py` (status). Skills lived only in `.agents/skills/`, which Claude Code does not read; there was no `CLAUDE.md`.

## External documentation checked

- https://code.claude.com/docs/en/headless — `claude -p --output-format json --json-schema` returns validated data in `structured_output`; it is absent when the run ends without valid output.
- https://code.claude.com/docs/en/cli-reference — `claude auth status --json` reports `authMethod` as `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper` or `third_party`; `--tools ""`, `--setting-sources ""` and `--no-session-persistence` behave as used here.
- https://code.claude.com/docs/en/authentication — `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY`/`ANTHROPIC_AWS` take precedence over a subscription login.

## Agreed decisions

Q1: Same guarantees as Codex — subscription logins only (`claude.ai`, `oauth_token`); strip API-key, gateway and cloud-provider variables; isolated temporary cwd; no tools, MCP servers, settings files, skills or saved sessions; five-minute timeout and cancellation.

Q1a: Amazon Bedrock is supported as an explicit, non-default opt-in (`--claude-auth bedrock`/`JSF_CLAUDE_AUTH=bedrock`). It keeps only `CLAUDE_CODE_USE_BEDROCK` and the caller's AWS variables, requires a `third_party`/`bedrock` login, and is keyed separately in cache versions. API keys, gateways, Vertex and Foundry remain unsupported.

Q2: Provider selection is per process: `--ai-provider` or `JSF_AI_PROVIDER`, otherwise the first installed CLI with Codex first, so existing setups are unchanged. No UI switch in this version.

Q3: Reusable-fact cache versions include the provider; switching re-extracts once rather than mixing models' facts.

Q4: Expose the existing skills to Claude Code through a `.claude/skills` symlink and a `CLAUDE.md` that imports `AGENTS.md`, without duplicating skill files.

## Implementation

`bridge_common` holds the provider-neutral prompt contract, schemas, cancellable process runner and annotation validation. `codex_bridge` keeps its behavior on those helpers; `claude_bridge` adds the Claude Code equivalent; `ai` selects the bridge and is the only module callers import. The readiness check key is `ai`, labelled with the selected provider. UI and messages are provider-neutral.

## Verification

Automated suites mock both CLIs: command flags, stripped billing variables, structured-output acceptance and rejection (declined, incomplete, nonzero exit), subscription-only status, provider selection, provider-specific cache versions, and process-group cancellation for each provider. The real `claude` CLI accepted the exact flag set (an unknown flag is rejected, the real set fails only at sign-in). One live annotation batch of the fictional test vacancy ran through Claude Code on Amazon Bedrock and returned schema-valid, quote-backed facts (~16 s, ~2.2k input/1.2k output tokens). A Claude Code session in the repository listed all six `jsf-*` skills through the `.claude/skills` symlink. No live subscription call, LinkedIn search or candidate workspace was used.

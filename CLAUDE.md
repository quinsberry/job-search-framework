@AGENTS.md

## Claude Code

The job-search skills live in `.agents/skills/` and are exposed to Claude Code through the `.claude/skills` symlink, so `jsf-*` skills load the same way they do in Codex. `agents/openai.yaml` files are Codex-only metadata; Claude Code invokes these skills implicitly from their descriptions.

The local app's CV interpretation and vacancy search can run on either AI CLI. Select Claude Code with `--ai-provider claude` (app or `workflow.py`) or `JSF_AI_PROVIDER=claude`; otherwise the first installed CLI is used, Codex first. By default Claude Code must be signed in with a Claude subscription (`claude auth login`). Amazon Bedrock is an explicit opt-in: `--claude-auth bedrock` or `JSF_CLAUDE_AUTH=bedrock`, with `CLAUDE_CODE_USE_BEDROCK=1` and `AWS_PROFILE`/`AWS_REGION` in the environment. API-key, gateway, Vertex and Foundry access is not used.

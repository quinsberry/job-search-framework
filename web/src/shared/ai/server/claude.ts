import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider } from '../contracts';

type AuthMode = 'subscription' | 'bedrock';
const authModes: readonly AuthMode[] = ['subscription', 'bedrock'];
// Logins backed by a Claude subscription, as reported by `claude auth status --json`.
const subscriptionMethods = ['claude.ai', 'oauth_token'];
// Any of these makes the CLI bill an API key, gateway or another cloud account instead.
const billingOverrides = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_BASE_URL',
	'CLAUDE_CODE_USE_BEDROCK',
	'CLAUDE_CODE_USE_VERTEX',
	'CLAUDE_CODE_USE_FOUNDRY',
	'CLAUDE_CODE_USE_ANTHROPIC_AWS',
	'CLAUDECODE',
];
// Bedrock model IDs and inference profiles; a subscription login rejects them, so they reach only the Bedrock route.
const modelOverrides = [
	'ANTHROPIC_MODEL',
	'ANTHROPIC_DEFAULT_OPUS_MODEL',
	'ANTHROPIC_DEFAULT_SONNET_MODEL',
	'ANTHROPIC_DEFAULT_HAIKU_MODEL',
	'ANTHROPIC_SMALL_FAST_MODEL',
];

function authMode(): AuthMode {
	const mode = process.env.JSF_CLAUDE_AUTH?.trim().toLowerCase() || 'subscription';
	if (!authModes.includes(mode as AuthMode))
		throw new Error(`Available JSF_CLAUDE_AUTH options: ${authModes.map((m) => `'${m}'`).join(', ')}.`);
	return mode as AuthMode;
}

// Never silently fall back to API-key or cloud billing; Bedrock only when JSF_CLAUDE_AUTH=bedrock chooses it.
function environment(mode: AuthMode) {
	const stripped = mode === 'bedrock' ? billingOverrides : [...billingOverrides, ...modelOverrides];
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key, value]) => value !== undefined && !stripped.includes(key)),
	) as Record<string, string>;
	if (mode === 'bedrock') env.CLAUDE_CODE_USE_BEDROCK = '1';
	return env;
}

function readiness(mode: AuthMode, status: { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown }) {
	if (mode === 'bedrock') {
		const available =
			status.loggedIn === true && status.authMethod === 'third_party' && status.apiProvider === 'bedrock';
		return {
			available,
			message: available
				? 'Connected through Amazon Bedrock (billed to your AWS account).'
				: 'Claude Code could not use Amazon Bedrock. Check AWS_REGION, AWS_PROFILE and your AWS credentials.',
		};
	}
	const available = status.loggedIn === true && subscriptionMethods.includes(status.authMethod as string);
	return {
		available,
		message: available
			? 'Connected through your Claude subscription.'
			: 'Run claude auth login in your terminal, then Connect again. A Claude subscription login is required.' +
				(process.env.CLAUDE_CODE_USE_BEDROCK ? ' To use Amazon Bedrock, set JSF_CLAUDE_AUTH=bedrock.' : ''),
	};
}

export const claudeProvider: AIProvider & { readonly id: 'claude' } = {
	id: 'claude',
	async check() {
		let mode: AuthMode;
		try {
			mode = authMode();
		} catch (error) {
			return {
				available: false,
				cacheIdentity: 'claude-cli:default',
				message: (error as Error).message,
			};
		}
		try {
			const child = Bun.spawn(['claude', 'auth', 'status', '--json'], {
				env: environment(mode),
				stdout: 'pipe',
				stderr: 'ignore',
				timeout: 10_000,
			});
			const version = Bun.spawn(['claude', '--version'], {
				env: environment(mode),
				stdout: 'pipe',
				stderr: 'ignore',
				timeout: 10_000,
			});
			const [stdout, code, versionText, versionCode] = await Promise.all([
				new Response(child.stdout).text(),
				child.exited,
				new Response(version.stdout).text(),
				version.exited,
			]);
			if (versionCode !== 0) throw new Error('Could not check Claude version.');

			const status = code === 0 ? JSON.parse(stdout) : {};
			return {
				...readiness(mode, status),
				cacheIdentity: claudeCacheIdentity(versionText, mode),
			};
		} catch {
			return {
				available: false,
				cacheIdentity: 'claude-cli:default',
				message: 'Claude Code CLI is unavailable. Install it, run claude auth login, then Connect again.',
			};
		}
	},
	async interpret(request, signal) {
		const mode = authMode();
		// Empty working folder so no project CLAUDE.md or files are in reach.
		const folder = await mkdtemp(join(tmpdir(), 'candidate-interpret-'));
		try {
			const child = Bun.spawn(
				[
					'claude',
					'-p',
					'--tools',
					'',
					'--strict-mcp-config',
					'--setting-sources',
					'',
					'--disable-slash-commands',
					'--no-session-persistence',
					'--output-format',
					'json',
					'--json-schema',
					JSON.stringify(request.outputSchema),
					'--system-prompt',
					request.instructions,
				],
				{
					cwd: folder,
					env: environment(mode),
					stdin: new Blob(['<untrusted_input>\n' + request.inputText + '\n</untrusted_input>']),
					stdout: 'pipe',
					stderr: 'ignore',
					timeout: 300_000,
				},
			);
			const cancel = () => child.kill();
			signal.addEventListener('abort', cancel, { once: true });
			if (signal.aborted) cancel();
			try {
				const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
				if (signal.aborted) throw new Error('Claude request cancelled. Retry may spend tokens again.');
				const result = code === 0 ? JSON.parse(stdout) : null;
				if (!result || result.is_error || result.structured_output === undefined)
					throw new Error(
						mode === 'bedrock'
							? 'Claude request failed or timed out. Check your AWS credentials and retry explicitly.'
							: 'Claude request failed or timed out. Check your login and retry explicitly.',
					);
				return result.structured_output;
			} finally {
				signal.removeEventListener('abort', cancel);
			}
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	},
};

export const claudeCacheIdentity = (version: string, mode: AuthMode = 'subscription') =>
	'claude-cli:' + version.trim() + ':' + (mode === 'bedrock' ? 'bedrock' : 'default');

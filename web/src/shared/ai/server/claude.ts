import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider } from '../contracts';

function environment() {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			([key, value]) => value !== undefined && !/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDECODE$)/.test(key),
		),
	) as Record<string, string>;
}
export const claudeProvider: AIProvider & { readonly id: 'claude' } = {
	id: 'claude',
	async check() {
		try {
			const child = Bun.spawn(['claude', 'auth', 'status', '--json'], {
				env: environment(),
				stdout: 'pipe',
				stderr: 'ignore',
				timeout: 10_000,
			});
			const version = Bun.spawn(['claude', '--version'], {
				env: environment(),
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
			const available = status.loggedIn === true && status.authMethod === 'claude.ai';
			return {
				available,
				cacheIdentity: claudeCacheIdentity(versionText),
				message: available
					? 'Claude is available through your Claude subscription login.'
					: 'Run claude auth login in your terminal, then Connect again. A Claude subscription login is required.',
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
					env: environment(),
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
					throw new Error('Claude request failed or timed out. Check your login and retry explicitly.');
				return result.structured_output;
			} finally {
				signal.removeEventListener('abort', cancel);
			}
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	},
};

export const claudeCacheIdentity = (version: string) => 'claude-cli:' + version.trim() + ':default';

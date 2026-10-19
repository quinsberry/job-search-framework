import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProvider } from '../contracts';

function environment() {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			([key, value]) =>
				value !== undefined &&
				!/^(OPENAI_|AZURE_OPENAI_|CODEX_INTERNAL_|CODEX_API_KEY|CODEX_BASE_URL)/.test(key),
		),
	) as Record<string, string>;
}
export const codexProvider: AIProvider & { readonly id: 'codex' } = {
	id: 'codex',
	async check() {
		try {
			const child = Bun.spawn(['codex', 'login', 'status'], {
				env: environment(),
				stdout: 'pipe',
				stderr: 'pipe',
				timeout: 10_000,
			});
			const version = Bun.spawn(['codex', '--version'], {
				env: environment(),
				stdout: 'pipe',
				stderr: 'ignore',
				timeout: 10_000,
			});
			const [stdout, stderr, code, versionText, versionCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
				new Response(version.stdout).text(),
				version.exited,
			]);
			if (versionCode !== 0) throw new Error('Could not check Codex version.');

			const available = code === 0 && /chatgpt/i.test(stdout + stderr);
			return {
				available,
				cacheIdentity: codexCacheIdentity(versionText),
				message: available
					? 'Codex is available through your ChatGPT login.'
					: 'Run codex login in your terminal, then Connect again. A ChatGPT login is required.',
			};
		} catch {
			return {
				available: false,
				cacheIdentity: 'codex-cli:default',
				message: 'Codex CLI is unavailable. Install it, run codex login, then Connect again.',
			};
		}
	},
	async interpret(request, signal) {
		const folder = await mkdtemp(join(tmpdir(), 'candidate-interpret-'));
		try {
			const schema = join(folder, 'schema.json');
			const output = join(folder, 'result.json');
			const jsonSchema = request.outputSchema;
			await writeFile(schema, JSON.stringify(jsonSchema));
			const prompt = request.instructions + '\n<untrusted_input>\n' + request.inputText + '\n</untrusted_input>';
			const child = Bun.spawn(
				[
					'codex',
					'exec',
					'--ignore-user-config',
					'--ignore-rules',
					'--ephemeral',
					'--skip-git-repo-check',
					'--sandbox',
					'read-only',
					'--cd',
					folder,
					'--output-schema',
					schema,
					'--output-last-message',
					output,
					'-c',
					'approval_policy="never"',
					'-c',
					'features.shell_tool=false',
					...[
						'apps',
						'plugins',
						'remote_plugin',
						'hooks',
						'multi_agent',
						'browser_use',
						'in_app_browser',
						'computer_use',
						'view_image',
						'image_generation',
						'code_mode_host',
					].flatMap((feature) => ['-c', `features.${feature}=false`]),
					'-c',
					'web_search="disabled"',
					'-c',
					'project_doc_max_bytes=0',
					'-c',
					'apps._default.enabled=false',
					'-',
				],
				{
					cwd: folder,
					env: environment(),
					stdin: new Blob([prompt]),
					stdout: 'ignore',
					stderr: 'ignore',
					timeout: 300_000,
				},
			);
			const cancel = () => child.kill();
			signal.addEventListener('abort', cancel, { once: true });
			if (signal.aborted) cancel();
			try {
				const code = await child.exited;
				if (signal.aborted) throw new Error('Codex request cancelled. Retry may spend tokens again.');
				if (code !== 0)
					throw new Error('Codex request failed or timed out. Check your login and retry explicitly.');
				const raw = await readFile(output, 'utf8');
				try {
					return JSON.parse(raw);
				} catch {
					return raw;
				}
			} finally {
				signal.removeEventListener('abort', cancel);
			}
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	},
};

export const codexCacheIdentity = (version: string) => 'codex-cli:' + version.trim() + ':default';

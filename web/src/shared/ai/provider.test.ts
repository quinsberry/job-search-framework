import { expect, spyOn, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { claudeProvider } from './server/claude';
import { codexProvider, codexCacheIdentity } from './server/codex';
const output = { fictional: 'structured output' };
test('checked provider identity preserves the pre-refactor spelling and is immutable per check', async () => {
	let version = 'codex-cli 1.0.0\n';
	const spawn = spyOn(Bun, 'spawn').mockImplementation(((command: string[]) => ({
		stdout: new Blob([command[1] === '--version' ? version : 'Logged in using ChatGPT']).stream(),
		stderr: new Blob([]).stream(),
		exited: Promise.resolve(0),
	})) as unknown as typeof Bun.spawn);
	try {
		const first = await codexProvider.check();
		version = 'codex-cli 2.0.0\n';
		const second = await codexProvider.check();
		expect(first.cacheIdentity).toBe('codex-cli:codex-cli 1.0.0:default');
		expect(first.cacheIdentity).not.toBe(second.cacheIdentity);
		expect(codexCacheIdentity('codex-cli 1.0.0\n')).toBe(first.cacheIdentity);
		expect(codexProvider).not.toHaveProperty('cacheIdentity');
	} finally {
		spawn.mockRestore();
	}
});

test('Codex conversion uses a restricted subprocess and validates the JSON handoff without a live AI call', async () => {
	const spawn = spyOn(Bun, 'spawn').mockImplementation(((command: string[]) => {
		const args = command as string[];
		expect(args).toContain('--ignore-user-config');
		expect(args).toContain('features.shell_tool=false');
		expect(args).toContain('features.plugins=false');
		expect(args).toContain('read-only');
		const outputPath = args[args.indexOf('--output-last-message') + 1];
		return {
			exited: writeFile(outputPath, JSON.stringify(output)).then(() => 0),
			kill: () => {},
		} as unknown as ReturnType<typeof Bun.spawn>;
	}) as typeof Bun.spawn);
	try {
		expect(
			await codexProvider.interpret(
				{
					instructions: 'Extract fictional facts.',
					inputText: 'Untrusted fictional CV',
					outputSchema: { type: 'object' },
				},
				new AbortController().signal,
			),
		).toEqual(output);
	} finally {
		spawn.mockRestore();
	}
});

test('Claude readiness requires a subscription login, not an API key', async () => {
	process.env.ANTHROPIC_API_KEY = 'fictional-key';
	let status = { loggedIn: true, authMethod: 'claude.ai' };
	const spawn = spyOn(Bun, 'spawn').mockImplementation(((command: string[], options: { env: object }) => {
		expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
		return {
			stdout: new Blob([command[1] === '--version' ? '2.1.292 (Claude Code)\n' : JSON.stringify(status)]).stream(),
			exited: Promise.resolve(0),
		};
	}) as unknown as typeof Bun.spawn);
	try {
		const ready = await claudeProvider.check();
		expect(ready.available).toBe(true);
		expect(ready.cacheIdentity).toBe('claude-cli:2.1.292 (Claude Code):default');
		status = { loggedIn: true, authMethod: 'api-key' };
		expect((await claudeProvider.check()).available).toBe(false);
	} finally {
		spawn.mockRestore();
		delete process.env.ANTHROPIC_API_KEY;
	}
});

test('Claude conversion uses a tool-less subprocess and returns the structured output without a live AI call', async () => {
	const spawn = spyOn(Bun, 'spawn').mockImplementation(((command: string[]) => {
		expect(command.slice(command.indexOf('--tools'), command.indexOf('--tools') + 2)).toEqual(['--tools', '']);
		expect(command).toContain('--strict-mcp-config');
		expect(command).toContain('--no-session-persistence');
		expect(command[command.indexOf('--json-schema') + 1]).toBe('{"type":"object"}');
		return {
			stdout: new Blob([JSON.stringify({ is_error: false, structured_output: output })]).stream(),
			exited: Promise.resolve(0),
			kill: () => {},
		};
	}) as unknown as typeof Bun.spawn);
	try {
		const request = {
			instructions: 'Extract fictional facts.',
			inputText: 'Untrusted fictional CV',
			outputSchema: { type: 'object' },
		};
		expect(await claudeProvider.interpret(request, new AbortController().signal)).toEqual(output);
	} finally {
		spawn.mockRestore();
	}
});

function fakeClaude(status: object, seen: Record<string, string>[] = []) {
	return spyOn(Bun, 'spawn').mockImplementation(((command: string[], options: { env: Record<string, string> }) => {
		seen.push(options.env);
		return {
			stdout: new Blob([
				command[1] === '--version'
					? '2.1.292 (Claude Code)\n'
					: command[1] === '-p'
						? JSON.stringify({ is_error: false, structured_output: output })
						: JSON.stringify(status),
			]).stream(),
			exited: Promise.resolve(0),
			kill: () => {},
		};
	}) as unknown as typeof Bun.spawn);
}

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	Object.assign(process.env, values);
	return run().finally(() => {
		for (const [key, value] of Object.entries(previous))
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
	});
}

test('Claude readiness accepts a long-lived subscription token and hints at Bedrock when it is configured', () =>
	withEnv({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'fictional-bedrock-profile' }, async () => {
		const seen: Record<string, string>[] = [];
		let spawn = fakeClaude({ loggedIn: true, authMethod: 'oauth_token' }, seen);
		try {
			expect((await claudeProvider.check()).available).toBe(true);
			expect(seen[0]).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK');
			expect(seen[0]).not.toHaveProperty('ANTHROPIC_MODEL');
		} finally {
			spawn.mockRestore();
		}
		spawn = fakeClaude({
			loggedIn: true,
			authMethod: 'third_party',
			apiProvider: 'bedrock',
		});
		try {
			const ready = await claudeProvider.check();
			expect(ready.available).toBe(false);
			expect(ready.message).toContain('JSF_CLAUDE_AUTH=bedrock');
		} finally {
			spawn.mockRestore();
		}
	}));

test('Claude on Bedrock switches the CLI to Bedrock, keeps AWS and model variables and caches separately', () =>
	withEnv(
		{
			JSF_CLAUDE_AUTH: 'bedrock',
			CLAUDE_CODE_USE_BEDROCK: '',
			AWS_REGION: 'eu-central-1',
			ANTHROPIC_MODEL: 'fictional-profile',
			ANTHROPIC_API_KEY: 'fictional-key',
			CLAUDE_CODE_USE_VERTEX: '1',
		},
		async () => {
			const seen: Record<string, string>[] = [];
			const spawn = fakeClaude({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' }, seen);
			try {
				const ready = await claudeProvider.check();
				expect(ready.available).toBe(true);
				expect(ready.message).toContain('Amazon Bedrock');
				expect(ready.cacheIdentity).toBe('claude-cli:2.1.292 (Claude Code):bedrock');
				const request = {
					instructions: 'Extract fictional facts.',
					inputText: 'Fictional CV',
					outputSchema: {},
				};
				expect(await claudeProvider.interpret(request, new AbortController().signal)).toEqual(output);
				for (const env of seen) {
					expect(env).toMatchObject({
						CLAUDE_CODE_USE_BEDROCK: '1',
						AWS_REGION: 'eu-central-1',
						ANTHROPIC_MODEL: 'fictional-profile',
					});
					expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
					expect(env).not.toHaveProperty('CLAUDE_CODE_USE_VERTEX');
				}
			} finally {
				spawn.mockRestore();
			}
		},
	));

test('Claude on Bedrock is unavailable with a subscription login', () =>
	withEnv({ JSF_CLAUDE_AUTH: 'bedrock' }, async () => {
		const spawn = fakeClaude({ loggedIn: true, authMethod: 'claude.ai' });
		try {
			const ready = await claudeProvider.check();
			expect(ready.available).toBe(false);
			expect(ready.message).toContain('AWS credentials');
		} finally {
			spawn.mockRestore();
		}
	}));

test('an unknown Claude auth mode lists the available options instead of choosing billing', () =>
	withEnv({ JSF_CLAUDE_AUTH: 'aws' }, async () => {
		const spawn = fakeClaude({ loggedIn: true, authMethod: 'claude.ai' });
		try {
			const ready = await claudeProvider.check();
			expect(ready.available).toBe(false);
			expect(ready.message).toBe("Available JSF_CLAUDE_AUTH options: 'subscription', 'bedrock'.");
			const request = { instructions: 'x', inputText: 'x', outputSchema: {} };
			await expect(claudeProvider.interpret(request, new AbortController().signal)).rejects.toThrow(
				'JSF_CLAUDE_AUTH options',
			);
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			spawn.mockRestore();
		}
	}));

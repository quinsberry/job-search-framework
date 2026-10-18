import { expect, spyOn, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
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
		expect(first.cacheIdentity).toBe('codex-cli:codex-cli 1.0.0:default:profile-v1');
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

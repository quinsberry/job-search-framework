import { readdirSync } from 'node:fs';
import type { Linter } from 'eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import pluginQuery from '@tanstack/eslint-plugin-query';

const sourceFiles = '**/*.{ts,tsx}';
const serverFiles = ['**/server/**', '**/server.{ts,tsx}', '**/actions/**', '**/*.test.{ts,tsx}'];
const serverImports = ['bun', 'node:*', '**/server/**', '**/server', '**/server.*'];
const featureImports = ['@/modules/**', '**/modules/**'];
const appImports = ['@/app/**', '**/app/**'];
const domainImports = ['@/domain/**', '**/domain/**'];
const directories = (path: string) =>
	readdirSync(new URL(path, import.meta.url), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
const modules = directories('./src/modules/');
const domainParts = directories('./src/domain/');

type ImportBoundary = { group: string[]; allowTypeImports?: boolean };
function boundaries(directory: string, restrictedImports: ImportBoundary[]): Linter.Config[] {
	return [
		{
			files: [directory + '/' + sourceFiles],
			rules: { 'no-restricted-imports': ['error', { patterns: restrictedImports }] },
		},
		{
			files: [directory + '/' + sourceFiles],
			ignores: serverFiles,
			rules: {
				'no-restricted-imports': ['error', { patterns: [...restrictedImports, { group: serverImports }] }],
			},
		},
	];
}

const eslintConfig = defineConfig([
	...pluginQuery.configs['flat/recommended-strict'],
	...nextVitals,
	...nextTs,
	...boundaries('src/shared', [{ group: [...featureImports, ...domainImports] }]),
	// Domain parts may share contracts, never server code; nothing in the domain knows features or the app.
	...boundaries('src/domain', [{ group: [...featureImports, ...appImports] }]),
	...domainParts.flatMap((part) =>
		boundaries('src/domain/' + part, [
			{ group: [...featureImports, ...appImports] },
			{
				group: domainParts
					.filter((other) => other !== part)
					.flatMap((other) => [
						'@/domain/' + other + '/server',
						'@/domain/' + other + '/server/**',
						'**/' + other + '/server',
						'**/' + other + '/server/**',
					]),
			},
		]),
	),
	...modules.flatMap((module) =>
		boundaries('src/modules/' + module, [
			{
				group: modules
					.filter((other) => other !== module)
					.flatMap((other) => ['@/modules/' + other + '/**', '**/' + other + '/**']),
				allowTypeImports: true,
			},
		]),
	),
	globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
export default eslintConfig;

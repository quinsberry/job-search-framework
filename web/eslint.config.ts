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
const modules = readdirSync(new URL('./src/modules/', import.meta.url), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

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
	...boundaries('src/shared', [{ group: featureImports }]),
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

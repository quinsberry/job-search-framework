import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import pluginQuery from '@tanstack/eslint-plugin-query';

const eslintConfig = defineConfig([
	...pluginQuery.configs['flat/recommended-strict'],
	...nextVitals,
	...nextTs,
	{
		files: ['src/shared/**/*.{ts,tsx}'],
		rules: { 'no-restricted-imports': ['error', { patterns: ['@/modules/**', '**/modules/**'] }] },
	},
	{
		files: ['src/modules/profile/{client,model,ui}/**/*.{ts,tsx}', 'src/modules/profile/candidate-profile.tsx'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						'bun',
						'node:*',
						'@/shared/ai/server/**',
						'@/modules/**/server/**',
						'**/server/**',
						'**/server',
						'@/modules/profile/server/**',
					],
				},
			],
		},
	},
	{
		files: ['src/modules/{workspace,agent}/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{ patterns: ['@/modules/profile/**', '**/profile/**', 'bun', 'node:*', '**/server/**', '**/server'] },
			],
		},
	},
	// Override default ignores of eslint-config-next.
	globalIgnores([
		// Default ignores of eslint-config-next:
		'.next/**',
		'out/**',
		'build/**',
		'next-env.d.ts',
	]),
]);

export default eslintConfig;

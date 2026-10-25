import { expect, test } from 'bun:test';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('.', import.meta.url)) });

test.each([
	['src/shared/ai/contracts.ts', './server/providers', false],
	['src/shared/future/contracts.ts', '../server/adapter', false],
	['src/shared/future/contracts.ts', 'node:fs/promises', false],
	['src/modules/applications/model.ts', '@/shared/ai/server/providers', false],
	['src/modules/profile/client/api.ts', '../server/application', false],
	['src/shared/ai/server/providers.ts', 'node:fs/promises', true],
	['src/shared/http/server.ts', 'node:fs/promises', true],
	['src/shared/actions/select-directory.ts', 'node:fs/promises', true],
	['src/shared/ai/provider.test.ts', './server/codex', true],
	['src/modules/profile/ui/editor.tsx', '../model/contracts', true],
	['src/modules/profile/ui/editor.tsx', '@/modules/search/schema', false],
	['src/modules/profile/server/application.ts', '../../search/server/persistence', false],
	['src/shared/future/contracts.ts', '@/modules/profile/model/contracts', false],
	['src/shared/http/client.ts', '@/domain/matching/contracts', false],
	['src/shared/future/contracts.ts', '../../domain/vocabulary', false],
	['src/domain/matching/contracts.ts', '@/modules/search/model/schema', false],
	['src/domain/matching/server/match.ts', '../../../modules/search/model/schema', false],
	['src/domain/vocabulary.ts', '@/modules/search/model/schema', false],
	['src/domain/search-sources/contracts.ts', '@/app/workspace-content', false],
	['src/domain/matching/server/match.ts', '../../../app/api/applications/run/route', false],
	['src/domain/matching/server/match.ts', '@/domain/search-sources/contracts', true],
	['src/domain/matching/server/match.ts', '../../search-sources/contracts', true],
	['src/domain/matching/server/match.ts', '@/domain/search-sources/server/search.service', false],
	['src/domain/matching/server/evaluation/evaluation.ts', '../../../search-sources/server/linkedin/detail', false],
	[
		'src/domain/matching/server/evaluation/evaluation.test.ts',
		'@/domain/search-sources/server/linkedin/detail',
		false,
	],
	['src/domain/matching/server/match.ts', './decision-model', true],
	['src/domain/matching/server/match.ts', 'node:fs/promises', true],
	['src/domain/matching/contracts.ts', './server/match', false],
	['src/domain/search-sources/contracts.ts', 'node:fs/promises', false],
	['src/domain/search-sources/contracts.ts', '../vocabulary', true],
	['src/domain/vocabulary.ts', '@/domain/search-sources/server/search.service', false],
	['src/modules/applications/model/contracts.ts', '@/domain/matching/contracts', true],
	['src/modules/search/ui/preferences-fields.tsx', '@/domain/vocabulary', true],
	['src/app/api/applications/run/route.ts', '@/domain/matching/server/match', true],
	['src/modules/applications/ui/rows.ts', '@/domain/matching/server/match', false],
	// Command entry points sit outside the source tree and wire modules like a composition root.
	['scripts/evaluation/run.ts', '@/modules/profile/server/persistence', true],
	['scripts/evaluation/run.ts', 'node:util', true],
])('%s importing %s: allowed=%s', async (filePath, source, allowed) => {
	const [result] = await eslint.lintText(`import { value } from '${source}';`, { filePath });
	const errors = result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
	expect(errors.length).toBe(allowed ? 0 : 1);
});

test('features can share types while shared and domain code stay independent of features', async () => {
	for (const [filePath, allowed] of [
		['src/modules/profile/profile-section.tsx', true],
		['src/shared/future/contracts.ts', false],
		['src/domain/matching/contracts.ts', false],
		['src/domain/search-sources/server/search.service.ts', false],
	] as const) {
		const [result] = await eslint.lintText(
			"import type { LoadedWorkspace } from '@/modules/workspace/contracts';",
			{ filePath },
		);
		expect(result.messages.filter((message) => message.ruleId === 'no-restricted-imports').length).toBe(
			allowed ? 0 : 1,
		);
	}
});

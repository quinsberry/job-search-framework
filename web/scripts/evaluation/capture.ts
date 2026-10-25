import { parseArgs } from 'node:util';
import { fetchJobDetail, resolveJobUrl } from '@/domain/search-sources/server/search.service';
import { captureVacancy, EvaluationError, labelSchema } from '@/domain/matching/server/evaluation/evaluation';
import { fail, interruptSignal, savedCandidate, workspacePath } from './workspace';

const usage = `Usage: bun run evaluate:capture --workspace <folder> --url <vacancy URL> --expected <outcome>
  [--criterion <name>=<met|failed|unknown>]... [--note <text>] [--relabel]

Outcomes: match, no-match, needs-clarification.
Criteria: availability, salary, workArrangement, location, role, seniority, positionType, skills.`;

const { values } = parseArgs({
	options: {
		workspace: { type: 'string' },
		url: { type: 'string' },
		expected: { type: 'string' },
		criterion: { type: 'string', multiple: true },
		note: { type: 'string' },
		relabel: { type: 'boolean' },
		help: { type: 'boolean' },
	},
	strict: true,
});
if (values.help) {
	console.log(usage);
	process.exit(0);
}
const workspace = workspacePath(values.workspace);
if (!values.url || !values.expected) fail(usage);
const label = labelSchema.safeParse({
	expected: values.expected,
	criteria: Object.fromEntries((values.criterion ?? []).map((item) => item.split('=', 2))),
	note: values.note ?? null,
});
if (!label.success) fail(`Invalid label.\n\n${usage}`);

try {
	const { file, relabelled } = await captureVacancy(
		{ workspace, url: values.url, label: label.data, relabel: values.relabel },
		{
			resolveUrl: resolveJobUrl,
			fetchDetail: fetchJobDetail,
			candidate: () => savedCandidate(workspace),
			now: () => new Date(),
		},
		interruptSignal(),
	);
	console.log(`${relabelled ? 'Relabelled' : 'Captured'} ${file} as ${label.data.expected}.`);
} catch (error) {
	fail(error instanceof EvaluationError ? error.message : `Capture failed: ${String(error)}`);
}

import { parseArgs } from 'node:util';
import { DecisionModelClient } from '@/modules/search/server/matching/decision-model';
import { EvaluationError, runEvaluation } from '@/modules/search/server/evaluation/evaluation';
import { fail, interruptSignal, savedCandidate, workspacePath } from './workspace';

const usage = `Usage: bun run evaluate:run --workspace <folder> --max-usd <amount> [--allow-unpriced] [--dry-run]

--max-usd         stop before the next decision model call once reported cost reaches this amount
--allow-unpriced  keep going after calls of unknown cost (they stop the run otherwise)
--dry-run         use a fake decision model at no cost, to check the set and the report`;

const { values } = parseArgs({
	options: {
		workspace: { type: 'string' },
		'max-usd': { type: 'string' },
		'allow-unpriced': { type: 'boolean' },
		'dry-run': { type: 'boolean' },
		help: { type: 'boolean' },
	},
	strict: true,
});
if (values.help) {
	console.log(usage);
	process.exit(0);
}
const workspace = workspacePath(values.workspace);
const maxUsd = Number(values['max-usd']);
if (values['max-usd'] === undefined || !Number.isFinite(maxUsd) || maxUsd < 0) fail(usage);
if (!values['dry-run'] && !process.env.OPENROUTER_API_KEY?.trim())
	fail('Set OPENROUTER_API_KEY, or pass --dry-run to check the set without the decision model.');

try {
	const { report, files } = await runEvaluation(
		{ workspace, maxUsd, allowUnpriced: values['allow-unpriced'], dryRun: values['dry-run'] },
		{ model: new DecisionModelClient(), candidate: () => savedCandidate(workspace), now: () => new Date() },
		interruptSignal(),
	);
	const percent = (rate: number | null) => (rate === null ? '—' : `${(rate * 100).toFixed(1)}%`);
	for (const warning of report.warnings) console.warn(`Warning: ${warning}`);
	if (report.modelMismatch)
		console.warn(`Warning: responses reported ${report.reportedModels.join(', ')}, not the requested model.`);
	console.log(
		`Evaluated ${report.totals.evaluated} of ${report.totals.vacancies} vacancies (${report.totals.errors} errors).`,
	);
	console.log(
		`Agreement ${percent(report.agreement.overall.rate)}, excluding needs-clarification ${percent(report.agreement.excludingNeedsClarification.rate)}.`,
	);
	console.log(
		`Cost $${report.cost.usd.toFixed(6)} over ${report.cost.calls} calls, ${report.cost.unpricedCalls} unpriced.`,
	);
	if (report.stopped) console.warn(`Stopped (${report.stopped.reason}): ${report.stopped.message}`);
	console.log(`Report: ${files.join('\n        ')}`);
	if (report.stopped?.reason === 'failed') process.exit(1);
} catch (error) {
	fail(error instanceof EvaluationError ? error.message : `Evaluation failed: ${String(error)}`);
}

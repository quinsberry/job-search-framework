import { requestedModel } from '../decision-model';
import type { EvaluationReport } from './evaluation';

const cell = (value: string | null) => (value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const rate = ({ agreed, total, rate }: EvaluationReport['agreement']['overall']) =>
	`| ${agreed} | ${total} | ${rate === null ? '—' : (rate * 100).toFixed(1) + '%'} |`;
function matrix(rows: Record<string, Record<string, number>>): string[] {
	const columns = Object.keys(Object.values(rows)[0]);
	return [
		`| Expected \\ Actual | ${columns.join(' | ')} |`,
		`| --- | ${columns.map(() => '---:').join(' | ')} |`,
		...Object.entries(rows).map(([expected, counts]) => `| ${expected} | ${Object.values(counts).join(' | ')} |`),
	];
}

export function renderReport(report: EvaluationReport): string {
	const requested = requestedModel(report.modelIdentity);
	const reported = report.reportedModels.length
		? report.reportedModels.map((model) => `\`${model}\``).join(', ') +
			(report.modelMismatch ? ` — **differs from the requested \`${requested}\`**` : '')
		: 'none reported';
	const lines = [
		`# Matching evaluation, ${report.generatedAt}`,
		'',
		`- Matching rules version: ${report.matchingRulesVersion}`,
		`- Decision model identity: \`${report.modelIdentity}\`${report.dryRun ? ' (dry run, no real matching)' : ''}`,
		`- Model reported by responses: ${reported}`,
		`- Vacancies: ${report.totals.vacancies}; evaluated ${report.totals.evaluated}, errors ${report.totals.errors}, not evaluated ${report.totals.notEvaluated}`,
		`- Run: ${report.stopped ? `**stopped (${report.stopped.reason})**: ${report.stopped.message}` : 'completed'}`,
		'',
	];
	if (report.warnings.length) lines.push('## Warnings', '', ...report.warnings.map((item) => `- ${item}`), '');
	lines.push(
		'## Agreement',
		'',
		'Excluding needs-clarification leaves out vacancies where either the label or matching says needs-clarification.',
		'',
		'| | Agreed | Of | Rate |',
		'| --- | ---: | ---: | ---: |',
		`| Overall ${rate(report.agreement.overall)}`,
		`| Excluding needs-clarification ${rate(report.agreement.excludingNeedsClarification)}`,
		'',
		'## Outcomes',
		'',
		...matrix(report.confusion),
		'',
	);
	const criteria = Object.entries(report.criteria);
	if (criteria.length) {
		lines.push('## Labelled criteria', '');
		for (const [criterion, counts] of criteria) lines.push(`### ${criterion}`, '', ...matrix(counts), '');
	}
	lines.push(
		'## Vacancies',
		'',
		'| Vacancy | Title | Expected | Actual | Differing criteria | Deciding criteria | Note |',
		'| --- | --- | --- | --- | --- | --- | --- |',
		...report.rows.map((row) =>
			[
				'',
				row.url ? `[${row.vacancy}](${row.url})` : row.vacancy,
				cell(row.title),
				row.expected ?? '',
				row.error ? `error: ${row.error.code}` : (row.actual ?? ''),
				row.differing.join(', '),
				row.deciding.join(', '),
				cell(row.note),
				'',
			]
				.join(' | ')
				.trim(),
		),
		'',
		'## Cost',
		'',
		`- Total: $${report.cost.usd.toFixed(6)} over ${report.cost.calls} decision model calls, cap $${report.cost.maxUsd}`,
		`- Unpriced calls: ${report.cost.unpricedCalls}${report.cost.allowUnpriced ? ' (allowed)' : ''}`,
		'',
	);
	return lines.join('\n');
}

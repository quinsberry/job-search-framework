import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkspaceFiles } from '@/shared/server/workspace-files';
import { jobDetailSchema, type SearchSourceAdapter } from '@/shared/search-sources/contracts';
import { fetchJobDetail, resolveJobUrl } from '@/shared/search-sources/server/search.service';
import { searchPreferencesSchema } from '../../model/schema';
import { requestedModel, type DecisionModel, type DecisionRequest } from '../matching/decision-model';
import { MATCHING_RULES_VERSION, MatchError, matchJob } from '../matching/match';
import { criterionSchema, type Criterion } from '../matching/structured';
import { renderReport } from './report';

// Opt-in matching accuracy evaluation: the job seeker's labelled vacancies, kept in their workspace only.
const NAMESPACE = 'matching-evaluation';
const SET = 'set.json';
const VACANCIES = 'vacancies';
const outcomes = ['match', 'no-match', 'needs-clarification'] as const;
const results = ['met', 'failed', 'unknown'] as const;
export type Outcome = (typeof outcomes)[number];
type Result = (typeof results)[number];
type Actual = Result | 'not-checked';

export const labelSchema = z.strictObject({
	expected: z.enum(outcomes),
	criteria: z.partialRecord(criterionSchema, z.enum(results)),
	note: z.string().trim().min(1).max(2000).nullable(),
});
export const candidateSchema = z.strictObject({
	preferences: searchPreferencesSchema,
	skills: z.array(z.string().trim().min(1).max(20000)).max(1000),
});
const setFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	createdAt: z.iso.datetime(),
	candidate: candidateSchema,
});
const vacancyFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	capturedAt: z.iso.datetime(),
	labelledAt: z.iso.datetime(),
	job: jobDetailSchema,
	label: labelSchema,
});
export type Label = z.infer<typeof labelSchema>;
export type Candidate = z.infer<typeof candidateSchema>;

export class EvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EvaluationError';
	}
}

const writeJson = (files: WorkspaceFiles, name: string, value: unknown) =>
	files.writeBytes(name, JSON.stringify(value, null, '\t') + '\n');

export type CaptureDeps = {
	sources: readonly SearchSourceAdapter[];
	// The workspace's saved (published) matching inputs, never drafts; null when nothing is saved.
	candidate(): Promise<Candidate | null>;
	now(): Date;
};

export async function captureVacancy(
	input: { workspace: string; url: string; label: Label; relabel?: boolean },
	deps: CaptureDeps,
	signal: AbortSignal,
): Promise<{ file: string; relabelled: boolean }> {
	const parsed = labelSchema.safeParse(input.label);
	if (!parsed.success) throw new EvaluationError('Invalid label: ' + z.prettifyError(parsed.error));
	const label = parsed.data;
	const ref = resolveJobUrl(input.url, deps.sources);
	if (!ref)
		throw new EvaluationError(
			'No search source recognises this URL. Give the vacancy page link, such as a LinkedIn job view URL.',
		);
	const files = await WorkspaceFiles.open(input.workspace, NAMESPACE);
	const file = `${VACANCIES}/${ref.sourceId}-${ref.sourceJobId}.json`;
	const now = deps.now().toISOString();
	const existing = await files.read(file);
	if (existing !== null) {
		if (!input.relabel)
			throw new EvaluationError(
				`This vacancy is already captured (${file}). Pass --relabel to replace its label.`,
			);
		const stored = vacancyFileSchema.parse(JSON.parse(existing));
		await writeJson(files, file, { ...stored, labelledAt: now, label });
		return { file, relabelled: true };
	}
	if ((await files.read(SET)) === null) {
		const candidate = await deps.candidate();
		if (!candidate)
			throw new EvaluationError('Save your search preferences first: labels refer to a snapshot of them.');
		await writeJson(files, SET, { schemaVersion: 1, createdAt: now, candidate: candidateSchema.parse(candidate) });
	}
	const detail = await fetchJobDetail(ref, signal, deps.sources);
	if (!detail.ok)
		throw new EvaluationError(`The vacancy could not be fetched (${detail.error.code}): ${detail.error.message}`);
	await writeJson(files, file, { schemaVersion: 1, capturedAt: now, labelledAt: now, job: detail.job, label });
	return { file, relabelled: false };
}

export type EvaluationDeps = {
	model: DecisionModel;
	candidate(): Promise<Candidate | null>;
	now(): Date;
};
export type EvaluationRow = {
	vacancy: string;
	title: string | null;
	url: string | null;
	expected: Outcome | null;
	actual: Outcome | null;
	criteria: { criterion: Criterion; expected: Result; actual: Actual }[];
	differing: Criterion[];
	// The failed criteria behind a no-match, or the unknown ones behind needs-clarification.
	deciding: Criterion[];
	note: string | null;
	error: { code: string; message: string } | null;
};
type Agreement = { agreed: number; total: number; rate: number | null };
export type EvaluationReport = {
	schemaVersion: 1;
	generatedAt: string;
	dryRun: boolean;
	matchingRulesVersion: number;
	modelIdentity: string;
	reportedModels: string[];
	modelMismatch: boolean;
	stopped: { reason: 'cost-cap' | 'failed' | 'cancelled'; code: string | null; message: string } | null;
	warnings: string[];
	totals: { vacancies: number; evaluated: number; errors: number; notEvaluated: number };
	confusion: Record<Outcome, Record<Outcome, number>>;
	agreement: { overall: Agreement; excludingNeedsClarification: Agreement };
	criteria: Partial<Record<Criterion, Record<Result, Record<Actual, number>>>>;
	rows: EvaluationRow[];
	cost: { usd: number; calls: number; unpricedCalls: number; maxUsd: number; allowUnpriced: boolean };
};

// Counts every call priced or unpriced and refuses the next call once the cap is reached.
// A failed call's cost is unknown, so it counts as unpriced, as in the search run summary.
class Meter implements DecisionModel {
	readonly identity: string;
	readonly maxInputBytes: number;
	readonly reportedModels = new Set<string>();
	costUsd = 0;
	calls = 0;
	unpricedCalls = 0;
	capped = false;
	constructor(
		private model: DecisionModel,
		private cap: { maxUsd: number; allowUnpriced: boolean },
	) {
		this.identity = model.identity;
		this.maxInputBytes = model.maxInputBytes;
	}
	async decide(request: DecisionRequest, signal: AbortSignal) {
		if (this.costUsd >= this.cap.maxUsd || (this.unpricedCalls && !this.cap.allowUnpriced)) {
			this.capped = true;
			throw new MatchError('cancelled', 'Cost cap reached');
		}
		this.calls++;
		try {
			const response = await this.model.decide(request, signal);
			if (response.costUsd === null) this.unpricedCalls++;
			else this.costUsd += response.costUsd;
			if (response.model) this.reportedModels.add(response.model);
			return response;
		} catch (error) {
			this.unpricedCalls++;
			throw error;
		}
	}
}

// Answers every question with even odds at no cost: it checks the set and the report, not matching.
const dryRunModel = (maxInputBytes: number): DecisionModel => ({
	identity: 'dry-run',
	maxInputBytes,
	async decide(request) {
		const answers = Object.fromEntries(
			Object.entries(request.questions).map(([id, question]) => [
				id,
				question.type === 'yes-no'
					? { probability: 0.5 }
					: question.type === 'scale'
						? { value: 50 }
						: {
								probabilities: Object.fromEntries(
									question.options.map((option) => [option, 1 / question.options.length]),
								),
							},
			]),
		);
		return { answers, costUsd: 0 };
	},
});

// The search workflow's failure policy (ADR 0009): these stop the run, other match errors skip one vacancy.
const fatalCodes = new Set(['invalid-input', 'unavailable', 'rate-limited']);

function drift(snapshot: Candidate, current: Candidate | null): string[] {
	if (!current) return ['There are no saved search preferences to compare with the candidate snapshot.'];
	// Only what matching consumes counts; run budgets do not.
	const matching = (candidate: Candidate) =>
		JSON.stringify([candidate.preferences.targetPosition, candidate.preferences.settings.minSkillMatch ?? null]);
	const skills = (candidate: Candidate) => JSON.stringify([...candidate.skills].sort());
	const warnings: string[] = [];
	if (matching(candidateSchema.parse(current)) !== matching(snapshot))
		warnings.push(
			'The saved search preferences differ from the candidate snapshot; results describe the snapshot.',
		);
	if (skills(current) !== skills(snapshot))
		warnings.push('The saved profile skills differ from the candidate snapshot; results describe the snapshot.');
	return warnings;
}

const agreement = (rows: EvaluationRow[]): Agreement => {
	const agreed = rows.filter((row) => row.expected === row.actual).length;
	return { agreed, total: rows.length, rate: rows.length ? agreed / rows.length : null };
};

export async function runEvaluation(
	options: { workspace: string; maxUsd: number; allowUnpriced?: boolean; dryRun?: boolean },
	deps: EvaluationDeps,
	signal: AbortSignal,
): Promise<{ report: EvaluationReport; files: string[] }> {
	if (!Number.isFinite(options.maxUsd) || options.maxUsd < 0)
		throw new EvaluationError('The cost cap must be a non-negative number of US dollars.');
	const files = await WorkspaceFiles.open(options.workspace, NAMESPACE);
	const setText = await files.read(SET);
	if (setText === null) throw new EvaluationError('Nothing to evaluate yet: capture labelled vacancies first.');
	const { candidate } = setFileSchema.parse(JSON.parse(setText));
	const names = (await readdir(join(files.workspace, NAMESPACE, VACANCIES)).catch(() => []))
		.filter((name) => name.endsWith('.json'))
		.sort();
	const dryRun = options.dryRun ?? false;
	const meter = new Meter(dryRun ? dryRunModel(deps.model.maxInputBytes) : deps.model, {
		maxUsd: dryRun ? Infinity : options.maxUsd,
		allowUnpriced: options.allowUnpriced ?? false,
	});
	const warnings = drift(candidate, await deps.candidate());
	const rows: EvaluationRow[] = [];
	let stopped: EvaluationReport['stopped'] = null;
	let notEvaluated = 0;
	for (const [index, name] of names.entries()) {
		const vacancy = name.slice(0, -'.json'.length);
		const base = { vacancy, title: null, url: null, expected: null, actual: null, criteria: [], differing: [] };
		let stored: z.infer<typeof vacancyFileSchema>;
		try {
			stored = vacancyFileSchema.parse(JSON.parse((await files.read(`${VACANCIES}/${name}`)) ?? ''));
		} catch {
			const message = 'The vacancy file is damaged or in an unknown format';
			rows.push({ ...base, deciding: [], note: null, error: { code: 'invalid-file', message } });
			continue;
		}
		const { job, label } = stored;
		const labelled = { ...base, title: job.title, url: job.url, expected: label.expected, note: label.note };
		try {
			const result = await matchJob(job, candidate, { model: meter }, signal);
			const criteria = Object.entries(label.criteria).map(([criterion, expected]) => ({
				criterion: criterion as Criterion,
				expected,
				actual:
					result.criteria.find((item) => item.criterion === criterion)?.result ?? ('not-checked' as const),
			}));
			const decidedBy = result.outcome === 'no-match' ? 'failed' : 'unknown';
			rows.push({
				...labelled,
				actual: result.outcome,
				criteria,
				differing: criteria.filter((item) => item.actual !== item.expected).map((item) => item.criterion),
				deciding: result.criteria.filter((item) => item.result === decidedBy).map((item) => item.criterion),
				error: null,
			});
		} catch (error) {
			const code = error instanceof MatchError ? error.code : null;
			const message = error instanceof Error ? error.message : 'Evaluation failed';
			if (meter.capped)
				stopped = {
					reason: 'cost-cap',
					code: null,
					message: meter.unpricedCalls
						? 'Stopped before the next call: a call of unknown cost was made and unpriced calls are not allowed'
						: 'Stopped before the next call: reported cost reached the cap',
				};
			else if (signal.aborted || code === 'cancelled') stopped = { reason: 'cancelled', code, message };
			else if (code === null || fatalCodes.has(code))
				stopped = { reason: 'failed', code: code ?? 'unavailable', message };
			else {
				rows.push({ ...labelled, deciding: [], error: { code, message } });
				continue;
			}
			notEvaluated = names.length - index;
			break;
		}
	}

	const evaluated = rows.filter((row) => row.expected && row.actual);
	const confusion = Object.fromEntries(
		outcomes.map((expected) => [
			expected,
			Object.fromEntries(
				outcomes.map((actual) => [
					actual,
					evaluated.filter((row) => row.expected === expected && row.actual === actual).length,
				]),
			),
		]),
	) as EvaluationReport['confusion'];
	const criteria: EvaluationReport['criteria'] = {};
	for (const row of evaluated)
		for (const item of row.criteria) {
			criteria[item.criterion] ??= Object.fromEntries(
				results.map((expected) => [expected, { met: 0, failed: 0, unknown: 0, 'not-checked': 0 }]),
			) as Record<Result, Record<Actual, number>>;
			criteria[item.criterion]![item.expected][item.actual]++;
		}
	const generatedAt = deps.now().toISOString();
	const reportedModels = [...meter.reportedModels].sort();
	const report: EvaluationReport = {
		schemaVersion: 1,
		generatedAt,
		dryRun,
		matchingRulesVersion: MATCHING_RULES_VERSION,
		modelIdentity: meter.identity,
		reportedModels,
		modelMismatch: reportedModels.some((model) => model !== requestedModel(meter.identity)),
		stopped,
		warnings,
		totals: {
			vacancies: names.length,
			evaluated: evaluated.length,
			errors: rows.filter((row) => row.error).length,
			notEvaluated,
		},
		confusion,
		agreement: {
			overall: agreement(evaluated),
			excludingNeedsClarification: agreement(
				evaluated.filter(
					(row) => row.expected !== 'needs-clarification' && row.actual !== 'needs-clarification',
				),
			),
		},
		criteria,
		rows,
		cost: {
			usd: meter.costUsd,
			calls: meter.calls,
			unpricedCalls: meter.unpricedCalls,
			maxUsd: options.maxUsd,
			allowUnpriced: options.allowUnpriced ?? false,
		},
	};
	const stamp = `reports/${generatedAt.replace(/[:.]/g, '-')}`;
	await writeJson(files, stamp + '.json', report);
	await files.writeBytes(stamp + '.md', renderReport(report));
	return { report, files: [stamp + '.md', stamp + '.json'].map((name) => join(files.workspace, NAMESPACE, name)) };
}

import { afterEach, expect, test } from 'bun:test';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobDetail } from '@/domain/search-sources/contracts';
import type { Answer, DecisionModel, DecisionRequest } from '../decision-model';
import { MatchError } from '../match';
import {
	captureVacancy,
	runEvaluation,
	type Candidate,
	type CaptureDeps,
	type EvaluationReport,
	type Label,
} from './evaluation';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const signal = () => new AbortController().signal;
const folders: string[] = [];
afterEach(async () => {
	await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function workspace({ sample = false } = {}) {
	const path = await mkdtemp(join(tmpdir(), 'evaluation-test-'));
	folders.push(path);
	if (sample) await cp(join(import.meta.dir, 'fixtures'), join(path, 'matching-evaluation'), { recursive: true });
	return path;
}
const sampleCandidate = async (): Promise<Candidate> =>
	JSON.parse(await readFile(join(import.meta.dir, 'fixtures', 'set.json'), 'utf8')).candidate;

// Answers like a model that judged the sample set: the frontend role fails, the unstated seniority is unknown.
function fakeModel(
	options: {
		costUsd?: number | null;
		model?: string;
		fail?: Record<string, MatchError>;
	} = {},
) {
	const requests: DecisionRequest[] = [];
	const titled = (request: DecisionRequest, title: string) => request.context.includes(`"title":"${title}"`);
	const model: DecisionModel = {
		identity: 'fake/model;format=1',
		maxInputBytes: 28000,
		async decide(request) {
			requests.push(request);
			for (const [title, error] of Object.entries(options.fail ?? {})) if (titled(request, title)) throw error;
			const accepted: Record<string, string> = {
				seniority: titled(request, 'Backend Engineer') ? 'unknown' : 'senior',
				positionType: 'full-time',
				workArrangement: 'remote',
			};
			const answers: Record<string, Answer> = {};
			for (const [id, question] of Object.entries(request.questions))
				answers[id] =
					question.type === 'yes-no'
						? { probability: titled(request, 'Frontend Developer') ? 0.05 : 0.95 }
						: question.type === 'scale'
							? { value: 90 }
							: {
									probabilities: Object.fromEntries(
										question.options.map((option) => [
											option,
											option === accepted[id] ? 0.9 : 0.1 / (question.options.length - 1),
										]),
									),
								};
			return {
				answers,
				costUsd: options.costUsd === undefined ? 0.25 : options.costUsd,
				...(options.model ? { model: options.model } : {}),
			};
		},
	};
	return { model, requests };
}
async function evaluate(
	path: string,
	model: DecisionModel,
	options: { maxUsd?: number; allowUnpriced?: boolean; dryRun?: boolean; candidate?: Candidate | null } = {},
) {
	const candidate = options.candidate === undefined ? await sampleCandidate() : options.candidate;
	const { files } = await runEvaluation(
		{ workspace: path, maxUsd: options.maxUsd ?? 10, ...options },
		{ model, candidate: async () => candidate, now: () => NOW },
		signal(),
	);
	const [markdown, json] = await Promise.all(files.map((file) => readFile(file, 'utf8')));
	return { report: JSON.parse(json) as EvaluationReport, markdown };
}
const outcomesOf = (report: EvaluationReport) =>
	report.rows.map((row) => [row.vacancy.slice(-1), row.expected, row.error ? row.error.code : row.actual]);

function fakeSource(jobs: JobDetail[]) {
	const details: string[] = [];
	const sources: Pick<CaptureDeps, 'resolveUrl' | 'fetchDetail'> = {
		resolveUrl(url) {
			const id = url.match(/^https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/(?:[^/]+-)?(\d+)\/?(?:\?.*)?$/)?.[1];
			return id
				? { sourceId: 'linkedin', sourceJobId: id, url: `https://www.linkedin.com/jobs/view/${id}` }
				: null;
		},
		async fetchDetail(ref) {
			details.push(ref.sourceJobId);
			const job = jobs.find((item) => item.sourceJobId === ref.sourceJobId);
			return job
				? { ok: true, job }
				: { ok: false, ref, error: { code: 'not-found', message: 'The vacancy is gone' } };
		},
	};
	return { sources, details };
}
async function sampleJob(id: string): Promise<JobDetail> {
	const file = join(import.meta.dir, 'fixtures', 'vacancies', `linkedin-${id}.json`);
	return JSON.parse(await readFile(file, 'utf8')).job;
}
const label = (expected: Label['expected'], extra: Partial<Label> = {}): Label => ({
	expected,
	criteria: {},
	note: null,
	...extra,
});

test('capture stores a validated snapshot with its label and the candidate snapshot', async () => {
	const path = await workspace();
	const source = fakeSource([await sampleJob('4200000001')]);
	const candidate = await sampleCandidate();
	const result = await captureVacancy(
		{
			workspace: path,
			url: 'https://pl.linkedin.com/jobs/view/senior-backend-engineer-at-fabrikam-4200000001/?trk=public',
			label: label('match', { criteria: { role: 'met' }, note: 'Exactly my stack' }),
		},
		{ ...source.sources, candidate: async () => candidate, now: () => NOW },
		signal(),
	);
	expect(result).toEqual({ file: 'vacancies/linkedin-4200000001.json', relabelled: false });
	const stored = JSON.parse(await readFile(join(path, 'matching-evaluation', result.file), 'utf8'));
	expect(stored).toEqual({
		schemaVersion: 1,
		capturedAt: NOW.toISOString(),
		labelledAt: NOW.toISOString(),
		job: await sampleJob('4200000001'),
		label: { expected: 'match', criteria: { role: 'met' }, note: 'Exactly my stack' },
	});
	const set = JSON.parse(await readFile(join(path, 'matching-evaluation', 'set.json'), 'utf8'));
	expect(set).toEqual({ schemaVersion: 1, createdAt: NOW.toISOString(), candidate });
});

test('capture refuses unknown URLs, unflagged re-captures and a workspace without saved preferences', async () => {
	const path = await workspace();
	const source = fakeSource([await sampleJob('4200000001')]);
	const deps = { ...source.sources, candidate: async () => sampleCandidate(), now: () => NOW };
	const url = 'https://www.linkedin.com/jobs/view/4200000001';
	for (const other of ['https://jobs.example.com/view/4200000001', 'https://www.linkedin.com/in/someone'])
		await expect(
			captureVacancy({ workspace: path, url: other, label: label('match') }, deps, signal()),
		).rejects.toThrow('No search source recognises this URL');
	await expect(
		captureVacancy(
			{ workspace: path, url, label: label('match') },
			{ ...deps, candidate: async () => null },
			signal(),
		),
	).rejects.toThrow('Save your search preferences first');
	expect(source.details).toEqual([]);

	await captureVacancy({ workspace: path, url, label: label('match') }, deps, signal());
	await expect(captureVacancy({ workspace: path, url, label: label('no-match') }, deps, signal())).rejects.toThrow(
		'Pass --relabel to replace its label',
	);
	await expect(
		captureVacancy(
			{ workspace: path, url: 'https://www.linkedin.com/jobs/view/4299999999', label: label('match') },
			deps,
			signal(),
		),
	).rejects.toThrow('could not be fetched (not-found)');
	expect(source.details).toEqual(['4200000001', '4299999999']);
});

test('relabel replaces only the label and never fetches again', async () => {
	const path = await workspace();
	const source = fakeSource([await sampleJob('4200000003')]);
	const url = 'https://www.linkedin.com/jobs/view/4200000003';
	await captureVacancy(
		{ workspace: path, url, label: label('match') },
		{ ...source.sources, candidate: sampleCandidate, now: () => NOW },
		signal(),
	);
	const file = join(path, 'matching-evaluation', 'vacancies', 'linkedin-4200000003.json');
	const before = JSON.parse(await readFile(file, 'utf8'));
	const later = new Date('2026-10-25T08:00:00.000Z');
	const result = await captureVacancy(
		{ workspace: path, url, label: label('needs-clarification', { note: 'Seniority is unclear' }), relabel: true },
		{ ...source.sources, candidate: async () => null, now: () => later },
		signal(),
	);
	expect(result.relabelled).toBe(true);
	expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
		...before,
		labelledAt: later.toISOString(),
		label: { expected: 'needs-clarification', criteria: {}, note: 'Seniority is unclear' },
	});
	expect(source.details).toEqual(['4200000003']);
});

test('a run over the sample set reports outcomes, agreement, labelled criteria, rows and cost', async () => {
	const path = await workspace({ sample: true });
	const { model, requests } = fakeModel({ model: 'fake/model' });
	const { report, markdown } = await evaluate(path, model);
	// Closed and on-site vacancies fail structured checks before any model call.
	expect(requests).toHaveLength(4);
	expect(outcomesOf(report)).toEqual([
		['1', 'match', 'match'],
		['2', 'no-match', 'no-match'],
		['3', 'match', 'needs-clarification'],
		['4', 'no-match', 'no-match'],
		['5', 'match', 'no-match'],
		['6', 'needs-clarification', 'match'],
	]);
	expect(report.confusion).toEqual({
		match: { match: 1, 'no-match': 1, 'needs-clarification': 1 },
		'no-match': { match: 0, 'no-match': 2, 'needs-clarification': 0 },
		'needs-clarification': { match: 1, 'no-match': 0, 'needs-clarification': 0 },
	});
	expect(report.agreement).toEqual({
		overall: { agreed: 3, total: 6, rate: 0.5 },
		excludingNeedsClarification: { agreed: 3, total: 4, rate: 0.75 },
	});
	const none = { met: 0, failed: 0, unknown: 0, 'not-checked': 0 };
	expect(report.criteria).toEqual({
		role: { met: none, failed: { ...none, failed: 1 }, unknown: none },
		seniority: { met: { ...none, unknown: 1 }, failed: none, unknown: none },
		availability: { met: none, failed: { ...none, failed: 1 }, unknown: none },
		workArrangement: { met: { ...none, failed: 1 }, failed: none, unknown: none },
	});
	expect(report.rows[2]).toMatchObject({
		differing: ['seniority'],
		deciding: ['seniority'],
		note: 'The team page says the role is senior',
	});
	expect(report.rows[4]).toMatchObject({ differing: ['workArrangement'], deciding: ['workArrangement'] });
	expect(report).toMatchObject({
		matchingRulesVersion: 1,
		modelIdentity: 'fake/model;format=1',
		reportedModels: ['fake/model'],
		modelMismatch: false,
		stopped: null,
		warnings: [],
		totals: { vacancies: 6, evaluated: 6, errors: 0, notEvaluated: 0 },
		cost: { usd: 1, calls: 4, unpricedCalls: 0 },
	});
	expect(markdown).toContain('| Overall | 3 | 6 | 50.0% |');
	expect(markdown).toContain('| Excluding needs-clarification | 3 | 4 | 75.0% |');
	expect(markdown).toContain('| match | 1 | 1 | 1 |');
	expect(markdown).toContain('| needs-clarification | 1 | 0 | 0 |');
	expect(markdown).toContain(
		'| [linkedin-4200000003](https://www.linkedin.com/jobs/view/4200000003) | Backend Engineer | match | needs-clarification | seniority | seniority | The team page says the role is senior |',
	);
	expect((await readdir(join(path, 'matching-evaluation', 'reports'))).sort()).toEqual([
		'2026-10-24T12-00-00-000Z.json',
		'2026-10-24T12-00-00-000Z.md',
	]);
});

test('a per-vacancy error becomes an error row outside agreement and the run continues', async () => {
	const path = await workspace({ sample: true });
	const { model } = fakeModel({ fail: { 'Frontend Developer': new MatchError('network', 'Connection reset') } });
	const { report, markdown } = await evaluate(path, model, { allowUnpriced: true });
	expect(outcomesOf(report)).toEqual([
		['1', 'match', 'match'],
		['2', 'no-match', 'network'],
		['3', 'match', 'needs-clarification'],
		['4', 'no-match', 'no-match'],
		['5', 'match', 'no-match'],
		['6', 'needs-clarification', 'match'],
	]);
	expect(report.agreement.overall).toEqual({ agreed: 2, total: 5, rate: 0.4 });
	expect(report.totals).toEqual({ vacancies: 6, evaluated: 5, errors: 1, notEvaluated: 0 });
	expect(report.stopped).toBeNull();
	expect(report.cost).toMatchObject({ usd: 0.75, calls: 4, unpricedCalls: 1 });
	expect(markdown).toContain('| no-match | error: network |');
});

test('an outage stops the run and still writes a partial report', async () => {
	const path = await workspace({ sample: true });
	const { model, requests } = fakeModel({
		fail: { 'Frontend Developer': new MatchError('unavailable', 'Decision model request failed (HTTP 503)') },
	});
	const { report, markdown } = await evaluate(path, model);
	expect(requests).toHaveLength(2);
	expect(outcomesOf(report)).toEqual([['1', 'match', 'match']]);
	expect(report.stopped).toEqual({
		reason: 'failed',
		code: 'unavailable',
		message: 'Decision model request failed (HTTP 503)',
	});
	expect(report.totals).toEqual({ vacancies: 6, evaluated: 1, errors: 0, notEvaluated: 5 });
	expect(markdown).toContain('**stopped (failed)**');
});

test('the cost cap stops the run before the call that would pass it', async () => {
	const path = await workspace({ sample: true });
	const { model, requests } = fakeModel({ costUsd: 0.25 });
	const { report } = await evaluate(path, model, { maxUsd: 0.5 });
	expect(requests).toHaveLength(2);
	expect(outcomesOf(report)).toEqual([
		['1', 'match', 'match'],
		['2', 'no-match', 'no-match'],
	]);
	expect(report.stopped?.reason).toBe('cost-cap');
	expect(report.cost).toMatchObject({ usd: 0.5, calls: 2, unpricedCalls: 0, maxUsd: 0.5 });
	expect(report.totals.notEvaluated).toBe(4);

	const { report: none, markdown } = await evaluate(path, fakeModel().model, { maxUsd: 0 });
	expect(none.rows).toEqual([]);
	expect(none.cost.calls).toBe(0);
	expect(markdown).toContain('reported cost reached the cap');
});

test('unpriced calls stop the run unless allowed', async () => {
	const path = await workspace({ sample: true });
	let { model, requests } = fakeModel({ costUsd: null });
	const stopped = await evaluate(path, model);
	expect(requests).toHaveLength(1);
	expect(stopped.report.stopped?.reason).toBe('cost-cap');
	expect(stopped.report.cost).toMatchObject({ usd: 0, calls: 1, unpricedCalls: 1 });
	expect(stopped.markdown).toContain('a call of unknown cost was made');

	({ model, requests } = fakeModel({ costUsd: null }));
	const allowed = await evaluate(path, model, { allowUnpriced: true });
	expect(requests).toHaveLength(4);
	expect(allowed.report.stopped).toBeNull();
	expect(allowed.report.cost).toMatchObject({ calls: 4, unpricedCalls: 4, allowUnpriced: true });
});

test('the report flags a drifted candidate and a reported model that differs from the requested one', async () => {
	const path = await workspace({ sample: true });
	const candidate = await sampleCandidate();
	const { report, markdown } = await evaluate(path, fakeModel({ model: 'fake/model-2026-09' }).model, {
		candidate: {
			...candidate,
			preferences: {
				...candidate.preferences,
				targetPosition: { ...candidate.preferences.targetPosition, seniority: ['staff'] },
			},
			skills: ['Go'],
		},
	});
	expect(report.modelMismatch).toBe(true);
	expect(report.warnings).toEqual([
		'The saved search preferences differ from the candidate snapshot; results describe the snapshot.',
		'The saved profile skills differ from the candidate snapshot; results describe the snapshot.',
	]);
	// Matching still uses the snapshot.
	expect(report.agreement.overall.agreed).toBe(3);
	expect(markdown).toContain('`fake/model-2026-09` — **differs from the requested `fake/model`**');
	expect(markdown).toContain('## Warnings');

	const budgetsOnly = await evaluate(path, fakeModel().model, {
		candidate: {
			...candidate,
			preferences: { ...candidate.preferences, settings: { maxJobsToProcess: 5, maxJobsToMatch: 1 } },
		},
	});
	expect(budgetsOnly.report.warnings).toEqual([]);
	const unsaved = await evaluate(path, fakeModel().model, { candidate: null });
	expect(unsaved.report.warnings).toEqual([
		'There are no saved search preferences to compare with the candidate snapshot.',
	]);
});

test('a dry run never calls the decision model and costs nothing', async () => {
	const path = await workspace({ sample: true });
	const paid: DecisionModel = {
		identity: 'fake/model;format=1',
		maxInputBytes: 28000,
		async decide() {
			throw new Error('Unexpected paid call');
		},
	};
	const { report, markdown } = await evaluate(path, paid, { dryRun: true, maxUsd: 0 });
	expect(report).toMatchObject({
		dryRun: true,
		modelIdentity: 'dry-run',
		stopped: null,
		totals: { vacancies: 6, evaluated: 6, errors: 0 },
		cost: { usd: 0, calls: 4, unpricedCalls: 0 },
	});
	expect(markdown).toContain('(dry run, no real matching)');
});

test('a damaged vacancy file affects only its own row', async () => {
	const path = await workspace({ sample: true });
	await Bun.write(join(path, 'matching-evaluation', 'vacancies', 'linkedin-4200000002.json'), '{"schemaVersion":');
	const { report } = await evaluate(path, fakeModel().model);
	expect(outcomesOf(report)[1]).toEqual(['2', null, 'invalid-file']);
	expect(report.totals).toMatchObject({ evaluated: 5, errors: 1 });
});

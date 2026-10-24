import { expect, test } from 'bun:test';
import { matchJob, MatchError, matchResultSchema } from '../match';
import { probabilityResult, scaleResult } from '../questions';
import type { Answer, DecisionModel, DecisionRequest } from '../decision-model';
import { fixture } from './structured.test';

function fake(overrides: Record<string, Answer> = {}) {
	const requests: DecisionRequest[] = [];
	const model: DecisionModel = {
		identity: 'fake-model',
		maxInputBytes: 28000,
		async decide(request) {
			requests.push(request);
			return {
				costUsd: 0.00003,
				answers: Object.fromEntries(
					Object.entries(request.questions).map(([id, question]) => [
						id,
						overrides[id] ??
							(question.type === 'yes-no'
								? { probability: 0.9 }
								: question.type === 'scale'
									? { value: 80 }
									: {
											probabilities: Object.fromEntries(
												question.options.map((option) => [
													option,
													option ===
													(id === 'seniority'
														? 'senior'
														: id === 'positionType'
															? 'full-time'
															: 'remote')
														? 1
														: 0,
												]),
											),
										}),
					]),
				),
			};
		},
	};
	return { model, requests };
}
const signal = () => new AbortController().signal;
const choice = (options: readonly string[], values: Record<string, number>): Answer => ({
	probabilities: Object.fromEntries(options.map((item) => [item, values[item] ?? 0])),
});
const arrangements = ['remote', 'on-site', 'hybrid', 'unknown'];

test('structured failures return before calling the model', async () => {
	const { job, ...criteria } = fixture();
	const deps = fake();
	job.availability = 'closed';
	expect(await matchJob(job, criteria, deps, signal())).toMatchObject({ outcome: 'no-match', costUsd: null });
	expect(deps.requests).toHaveLength(0);
});

test('strict outcomes combine met, failed and unknown without adding omitted criteria', async () => {
	const { job, ...criteria } = fixture();
	for (const [probability, outcome] of [
		[0.8, 'match'],
		[0.2, 'no-match'],
		[0.5, 'needs-clarification'],
	] as const) {
		const result = await matchJob(job, criteria, fake({ role: { probability } }), signal());
		expect(result.outcome).toBe(outcome);
		expect(result.costUsd).toBe(0.00003);
		expect(result.criteria.map((item) => item.criterion)).not.toContain('salary');
		expect(result.criteria.map((item) => item.criterion)).not.toContain('skills');
		expect(matchResultSchema.safeParse({ ...result, extra: true }).success).toBe(false);
	}
});

test('every model choice criterion yields met, failed and unknown from its evidence', async () => {
	const { job, ...criteria } = fixture();
	for (const [criterion, options, accepted, rejected] of [
		['seniority', ['junior', 'middle', 'senior', 'staff', 'unknown'], 'senior', 'junior'],
		['positionType', ['full-time', 'part-time', 'contract', 'internship', 'unknown'], 'full-time', 'internship'],
		['workArrangement', arrangements, 'remote', 'hybrid'],
	] as const) {
		for (const [option, expected] of [
			[accepted, 'met'],
			[rejected, 'failed'],
			['unknown', 'unknown'],
		] as const) {
			const result = await matchJob(
				job,
				criteria,
				fake({ [criterion]: choice([...options], { [option]: 1 }) }),
				signal(),
			);
			expect(result.criteria.find((item) => item.criterion === criterion)?.result).toBe(expected);
		}
	}
	criteria.preferences.targetPosition.workArrangements = ['hybrid'];
	criteria.preferences.targetPosition.location = { city: 'Warsaw', country: 'Poland' };
	job.advertisedFacts!.workArrangements = ['hybrid'];
	for (const [probability, expected] of [
		[0.8, 'met'],
		[0.2, 'failed'],
		[0.5, 'unknown'],
	] as const) {
		const result = await matchJob(job, criteria, fake({ location: { probability } }), signal());
		expect(result.criteria.find((item) => item.criterion === 'location')?.result).toBe(expected);
	}
});

test('probability and scale edges, including clamped 95% and 5% bands', () => {
	expect([0.2, 0.20001, 0.79999, 0.8].map(probabilityResult)).toEqual(['failed', 'unknown', 'unknown', 'met']);
	expect([0, 5, 15].map((value) => scaleResult(value, 5))).toEqual(['failed', 'unknown', 'met']);
	expect([85, 95, 100].map((value) => scaleResult(value, 95))).toEqual(['failed', 'unknown', 'met']);
});

test('accepted choice probabilities combine; unknown evidence is not rejection', async () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.targetPosition.workArrangements = ['remote', 'hybrid'];
	criteria.preferences.targetPosition.location = { city: 'Warsaw', country: 'Poland' };
	const deps = fake({
		workArrangement: choice(arrangements, { remote: 0.5, hybrid: 0.5 }),
		seniority: choice(['junior', 'middle', 'senior', 'staff', 'unknown'], { middle: 0.5, senior: 0.5 }),
	});
	const result = await matchJob(job, criteria, deps, signal());
	expect(result.outcome).toBe('match');
	for (const criterion of ['workArrangement', 'seniority'])
		expect(result.criteria.find((item) => item.criterion === criterion)?.result).toBe('met');
	const missing = await matchJob(
		job,
		criteria,
		fake({ workArrangement: choice(arrangements, { unknown: 1 }) }),
		signal(),
	);
	expect(missing.criteria.find((item) => item.criterion === 'workArrangement')?.result).toBe('unknown');
});

test('different structured city asks the model; remote-only results discard speculative location', async () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.targetPosition.workArrangements = ['remote', 'hybrid'];
	criteria.preferences.targetPosition.location = { city: 'Warsaw', country: 'Poland' };
	job.locations = [{ label: 'Gdynia', city: 'Gdynia', country: 'Poland' }];
	job.advertisedFacts!.workArrangements = ['hybrid'];
	const hybrid = fake({ location: { probability: 0.2 } });
	const result = await matchJob(job, criteria, hybrid, signal());
	expect(hybrid.requests[0].questions.location).toBeDefined();
	expect(result.criteria.find((item) => item.criterion === 'location')?.result).toBe('failed');
	job.advertisedFacts!.workArrangements = null;
	const remote = fake({ location: { probability: 0 } });
	const resolved = await matchJob(job, criteria, remote, signal());
	expect(remote.requests[0].questions.location).toBeDefined();
	expect(resolved.criteria.some((item) => item.criterion === 'location')).toBe(false);
	expect(resolved.outcome).toBe('match');
	job.advertisedFacts!.workArrangements = ['remote'];
	const knownRemote = fake();
	await matchJob(job, criteria, knownRemote, signal());
	expect(knownRemote.requests[0].questions.location).toBeUndefined();
});

test('a workplace elsewhere fails location unless the vacancy is confirmed remote', async () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.targetPosition.workArrangements = ['remote', 'hybrid', 'on-site'];
	criteria.preferences.targetPosition.location = { city: 'Warsaw', country: 'Poland' };
	job.locations = [{ label: 'Kraków', city: 'Kraków', country: 'Poland' }];
	const location = (result: Awaited<ReturnType<typeof matchJob>>) =>
		result.criteria.find((item) => item.criterion === 'location');
	const unknownArrangement = await matchJob(
		job,
		criteria,
		fake({ location: { probability: 0.01 }, workArrangement: choice(arrangements, { unknown: 1 }) }),
		signal(),
	);
	expect(location(unknownArrangement)?.result).toBe('failed');
	expect(unknownArrangement.outcome).toBe('no-match');
	const hybrid = await matchJob(
		job,
		criteria,
		fake({ location: { probability: 0.01 }, workArrangement: choice(arrangements, { hybrid: 1 }) }),
		signal(),
	);
	expect(hybrid.criteria.find((item) => item.criterion === 'workArrangement')?.detail).toContain(
		'most likely: hybrid',
	);
	const remote = await matchJob(
		job,
		criteria,
		fake({ location: { probability: 0.01 }, workArrangement: choice(arrangements, { remote: 0.9, unknown: 0.1 }) }),
		signal(),
	);
	expect(location(remote)).toBeUndefined();
});

test('skills scale excludes nice-to-haves and applies its threshold band', async () => {
	const { job, ...criteria } = fixture();
	criteria.preferences.settings.minSkillMatch = 50;
	for (const [value, expected] of [
		[40, 'failed'],
		[50, 'unknown'],
		[60, 'met'],
	] as const) {
		const deps = fake({ skills: { value } });
		const result = await matchJob(job, criteria, deps, signal());
		expect(result.criteria.find((item) => item.criterion === 'skills')?.result).toBe(expected);
		expect(deps.requests[0].questions.skills.text).toContain('Exclude nice-to-have');
	}
	criteria.skills = [];
	await expect(matchJob(job, criteria, fake(), signal())).rejects.toMatchObject({ code: 'invalid-input' });
});

test('200 KB multi-byte description fits UTF-8 input budget; truncation cannot match', async () => {
	const { job, ...criteria } = fixture();
	job.description = '😀漢字\n"'.repeat(18000);
	const deps = fake();
	const result = await matchJob(job, criteria, deps, signal());
	expect(Buffer.byteLength(job.description, 'utf8')).toBeGreaterThan(200000);
	expect(Buffer.byteLength(JSON.stringify(deps.requests[0]), 'utf8')).toBeLessThan(deps.model.maxInputBytes);
	expect(result.outcome).toBe('needs-clarification');
	expect(result.criteria.every((item) => item.result === 'unknown')).toBe(true);
	criteria.preferences.targetPosition.positionTitles = ['x'.repeat(20000), 'y'.repeat(20000)];
	await expect(matchJob(job, criteria, fake(), signal())).rejects.toMatchObject({ code: 'invalid-input' });
	criteria.preferences.targetPosition.positionTitles = ['Engineer'];
	criteria.preferences.settings.minSkillMatch = 50;
	criteria.skills = Array.from({ length: 100 }, () => 'x'.repeat(1000));
	await expect(matchJob(job, criteria, fake(), signal())).rejects.toMatchObject({ code: 'invalid-input' });
});

test('model and input failures reject as errors, never outcomes', async () => {
	const { job, ...criteria } = fixture();
	for (const code of [
		'network',
		'timeout',
		'invalid-response',
		'unavailable',
		'rate-limited',
		'cancelled',
	] as const) {
		const model: DecisionModel = {
			identity: 'fake-model',
		maxInputBytes: 28000,
			async decide() {
				throw new MatchError(code, 'Fictional failure');
			},
		};
		await expect(matchJob(job, criteria, { model }, signal())).rejects.toMatchObject({ code });
	}
	const malformed: DecisionModel = {
		identity: 'fake-model',
		maxInputBytes: 28000,
		async decide() {
			return { answers: {}, costUsd: null };
		},
	};
	await expect(matchJob(job, criteria, { model: malformed }, signal())).rejects.toMatchObject({
		code: 'invalid-response',
	});
	await expect(matchJob({ ...job, title: '' }, criteria, fake(), signal())).rejects.toMatchObject({
		code: 'invalid-input',
	});
	const controller = new AbortController();
	controller.abort();
	const deps = fake();
	await expect(matchJob(job, criteria, deps, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
	expect(deps.requests).toHaveLength(0);
	const pendingModel: DecisionModel = {
		identity: 'fake-model',
		maxInputBytes: 28000,
		async decide() {
			return new Promise(() => {});
		},
	};
	await expect(matchJob(job, criteria, { model: pendingModel }, AbortSignal.timeout(5))).rejects.toMatchObject({
		code: 'timeout',
	});
});

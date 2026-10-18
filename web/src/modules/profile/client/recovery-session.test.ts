import { expect, test } from 'bun:test';
import { createRecoverySession } from './recovery-session';
import { emptyProfile } from '../model/schema';
import { emptyState, type ProfileSnapshot } from '../model/contracts';
const snapshot = (revision: string): ProfileSnapshot => ({ ...structuredClone(emptyState), profile: null, revision });
const draft = (name: string) => ({
	values: { ...structuredClone(emptyProfile), identity: { ...emptyProfile.identity, fullName: name } },
	recordIds: {},
});
function setup(writer?: (revision: string, name: string) => Promise<ProfileSnapshot>, initial = snapshot('0')) {
	const calls: string[] = [];
	let scheduled: (() => void) | undefined;
	const session = createRecoverySession({
		id: 'workspace:session',
		initial,
		scheduler: {
			schedule: (callback) => {
				scheduled = callback;
				return callback;
			},
			cancel: (handle) => {
				if (scheduled === handle) scheduled = undefined;
			},
		},
		write: async (data, revision) => {
			calls.push(revision + ':' + data.values.identity.fullName);
			return writer ? writer(revision, data.values.identity.fullName) : snapshot(String(calls.length));
		},
	});
	return { session, calls, tick: () => scheduled?.() };
}
const turns = async () => {
	for (let n = 0; n < 8; n++) await Promise.resolve();
};
test('coalesces changes and serializes writes; late acknowledgments retain newer edits', async () => {
	let release!: (value: ProfileSnapshot) => void;
	const { session, calls } = setup(async () =>
		calls.length === 1
			? new Promise((resolve) => {
					release = resolve;
				})
			: snapshot('2'),
	);
	session.change(draft('A'));
	session.change(draft('B'));
	const flushing = session.flush();
	await turns();
	expect(calls).toEqual(['0:B']);
	session.change(draft('C'));
	release(snapshot('1'));
	await flushing;
	expect(calls).toEqual(['0:B', '1:C']);
	expect(session.hasPending()).toBe(false);
});
test('failed writes retain data and require explicit retry; conflicts refuse automatic retry', async () => {
	let failed = true;
	const { session, calls } = setup(async () => {
		if (failed) throw new Error('Disk full');
		return snapshot('1');
	});
	session.change(draft('A'));
	await expect(session.flush()).rejects.toThrow('Disk full');
	session.change(draft('B'));
	await expect(session.flush()).rejects.toThrow('Disk full');
	expect(calls).toHaveLength(1);
	failed = false;
	await session.retry();
	expect(calls).toEqual(['0:A', '0:B']);
	const conflict = setup(async () => {
		throw Object.assign(new Error('Changed externally'), { code: 'conflict' });
	});
	conflict.session.change(draft('X'));
	await expect(conflict.session.flush()).rejects.toThrow();
	await expect(conflict.session.retry()).rejects.toThrow();
	expect(conflict.calls).toHaveLength(1);
});
for (const kind of ['publish', 'discard', 'reload'] as const) {
	test(`${kind} reconciles its revision before the next edit`, async () => {
		const { session, calls } = setup();
		session.change(draft('Before'));
		await session.command(kind, async () => snapshot('command-revision'));
		session.change(draft('After'));
		await session.flush();
		expect(calls.at(-1)).toBe('command-revision:After');
	});
}
test('publish acknowledges its submitted generation, preserving edits made during the request', async () => {
	const { session, calls } = setup();
	let release!: (value: ProfileSnapshot) => void;
	const command = session.command(
		'publish',
		async () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	await turns();
	session.change(draft('Newer'));
	release(snapshot('saved'));
	await command;
	expect(session.hasPending()).toBe(true);
	await session.flush();
	expect(calls).toEqual(['saved:Newer']);
});
for (const phase of ['ready', 'failed', 'interrupted'] as const) {
	test(`restored conversion ${phase} reconciles once and rejects cross-session observations`, async () => {
		const job = {
			id: 'job',
			cacheKey: 'a'.repeat(64),
			source: 'b'.repeat(64) + '.md',
			provider: 'codex',
			phase: 'converting' as const,
			startedAt: 1,
			ownerPid: 1,
			ownerId: 'owner',
		};
		const { session, calls } = setup(undefined, { ...snapshot('initial'), job });
		const terminal = {
			...snapshot('terminal'),
			job: { ...job, phase },
			draft: phase === 'ready' ? { id: 'draft', ...draft('Converted') } : null,
		};
		expect(session.reconcile({ session: 'other', jobId: 'job', snapshot: terminal })).toBeNull();
		const replacement = session.reconcile({ session: 'workspace:session', jobId: 'job', snapshot: terminal });
		if (phase === 'ready') expect(replacement?.values.identity.fullName).toBe('Converted');
		expect(session.reconcile({ session: 'workspace:session', jobId: 'job', snapshot: terminal })).toBeNull();
		session.change(draft('Next'));
		await session.flush();
		expect(calls).toEqual(['terminal:Next']);
	});
}
test('start/retry acknowledgments track terminal revisions in command order', async () => {
	const { session, calls } = setup();
	const job = {
		id: 'new-job',
		cacheKey: 'a'.repeat(64),
		source: 'b'.repeat(64) + '.md',
		provider: 'codex',
		phase: 'reading' as const,
		startedAt: 1,
		ownerPid: 1,
		ownerId: 'owner',
	};
	await session.command('start', async (revision) => {
		expect(revision).toBe('0');
		return { ...snapshot('started'), job };
	});
	session.reconcile({
		session: 'workspace:session',
		jobId: job.id,
		snapshot: { ...snapshot('completed'), job: { ...job, phase: 'failed' } },
	});
	await session.command('retry', async (revision) => {
		expect(revision).toBe('completed');
		return { ...snapshot('retried'), job: { ...job, id: 'retry-job' } };
	});
	session.reconcile({
		session: 'workspace:session',
		jobId: 'retry-job',
		snapshot: { ...snapshot('ready'), job: { ...job, id: 'retry-job', phase: 'ready' } },
	});
	session.change(draft('Next'));
	await session.flush();
	expect(calls).toEqual(['ready:Next']);
});
test('destructive late completion retains newer edits until explicit reload', async () => {
	const { session } = setup();
	let release!: (value: ProfileSnapshot) => void;
	const command = session.command(
		'discard',
		async () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	await turns();
	session.change(draft('Newer'));
	release(snapshot('discarded'));
	await command;
	expect(session.getState().status).toBe('conflicted');
	expect(session.hasPending()).toBe(true);
	await expect(session.flush()).rejects.toThrow('Newer edits');
	await session.command('reload', async () => snapshot('reloaded'));
	expect(session.hasPending()).toBe(false);
});
test('disposal cancels scheduled writes without claiming durability', async () => {
	const { session, tick, calls } = setup();
	session.change(draft('Pending'));
	session.dispose();
	tick();
	await turns();
	expect(calls).toHaveLength(0);
	expect(session.hasPending()).toBe(true);
	expect(
		session.reconcile({
			ticket: { session: 'old', id: 1, generation: 1, kind: 'reload' },
			snapshot: snapshot('obsolete'),
		}),
	).toBeNull();
});

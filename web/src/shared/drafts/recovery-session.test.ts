import { expect, test } from 'bun:test';
import { createDraftSession } from './recovery-session';
type Snapshot = { revision: string; saved: string | null; draft: string | null };
const snapshot = (revision: string, saved: string | null = null): Snapshot => ({ revision, saved, draft: null });
function setup(write: (draft: string, revision: string) => Promise<Snapshot> = async (draft) => snapshot(draft)) {
	let tick: () => void = () => {};
	const initial = snapshot('0');
	const session = createDraftSession({
		id: 'test',
		initial,
		baseline: (value) => value.saved,
		draft: (value) => value.draft ?? value.saved ?? '',
		write,
		scheduler: {
			schedule: (callback) => {
				tick = callback;
				return callback;
			},
			cancel: () => {
				tick = () => {};
			},
		},
	});
	return { session, initial, tick: () => tick() };
}
const turns = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
test('confirmed Discard bypasses failed recovery and cancels scheduled writes', async () => {
	let writes = 0;
	const { session, tick } = setup(async () => {
		writes++;
		throw new Error('Temporary disk failure');
	});
	session.change('unfinished');
	await expect(session.flush()).rejects.toThrow('disk failure');
	let discarded = false;
	const result = await session.command('discard', async (revision) => {
		expect(revision).toBe('0');
		discarded = true;
		return snapshot('discarded', 'original');
	});
	expect(discarded).toBe(true);
	expect(result.replacement).toBe('original');
	expect(session.hasPending()).toBe(false);
	tick();
	await turns();
	expect(writes).toBe(1);
});
test('Discard waits for the in-flight write but skips its newer pending generation', async () => {
	let release!: (value: Snapshot) => void;
	const writes: string[] = [];
	const { session, tick } = setup((draft) => {
		writes.push(draft);
		return new Promise((resolve) => {
			release = resolve;
		});
	});
	session.change('A');
	const flush = session.flush();
	await turns();
	session.change('B');
	const discard = session.command('discard', async (revision) => {
		expect(revision).toBe('written-A');
		return snapshot('discarded');
	});
	release(snapshot('written-A'));
	await flush;
	await discard;
	tick();
	await turns();
	expect(writes).toEqual(['A']);
	expect(session.hasPending()).toBe(false);
});
test('a late Discard does not erase edits made while waiting for an in-flight write', async () => {
	let release!: (value: Snapshot) => void;
	const { session } = setup(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	session.change('A');
	const flush = session.flush();
	await turns();
	const discard = session.command('discard', async () => snapshot('discarded'));
	session.change('newer');
	release(snapshot('written-A'));
	await flush;
	expect((await discard).replacement).toBeNull();
	expect(session.hasPending()).toBe(true);
	expect(session.getState().status).toBe('conflicted');
});
test('external observations expose a conflict without rebasing; own and obsolete acknowledgments do not', async () => {
	const { session, initial } = setup(async () => snapshot('own'));
	session.change('A');
	await session.flush();
	session.observe(initial);
	session.observe(snapshot('own'));
	expect(session.getState().status).toBe('clean');
	session.observe(snapshot('external'));
	expect(session.getState().status).toBe('conflicted');
	await expect(session.flush()).rejects.toThrow('changed');
	await session.command('reload', async () => snapshot('external', 'external saved'));
	expect(session.getState().baseline).toBe('external saved');
	expect(session.getState().status).toBe('clean');
});
test('a fresh external read restoring old file contents still conflicts', async () => {
	const { session } = setup(async () => snapshot('own'));
	session.change('A');
	await session.flush();
	session.observe(snapshot('0'));
	expect(session.getState().status).toBe('conflicted');
});
test('failed Discard retains pending edits and requires explicit retry/reconciliation', async () => {
	const { session } = setup();
	session.change('keep me');
	await expect(
		session.command('discard', async () => {
			throw Object.assign(new Error('external conflict'), { code: 'conflict' });
		}),
	).rejects.toThrow('external conflict');
	expect(session.hasPending()).toBe(true);
	expect(session.getState().status).toBe('conflicted');
});

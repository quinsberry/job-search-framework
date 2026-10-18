import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test, type Mock } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let requestHeaders: Headers;
let output: string;
let failure: Error | null;
let exitCode: number;
let os: NodeJS.Platform;
let spawn: Mock<typeof Bun.spawn>;
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'jsf-picker-')));

mock.module('node:os', () => ({ platform: () => os }));
mock.module('next/headers', () => ({ headers: async () => requestHeaders }));

const { selectDirectory } = await import('./select-directory');

beforeEach(() => {
    requestHeaders = new Headers({ host: 'localhost:3000', origin: 'http://localhost:3000' });
    output = directory + '\n';
    failure = null;
    exitCode = 0;
    os = 'darwin';
    // Only the streams and exit status are needed from the subprocess fixture.
    spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
        if (failure) throw failure;
        return {
            stdout: new Blob([output]).stream(),
            stderr: new Blob([]).stream(),
            exited: Promise.resolve(exitCode),
        } as ReturnType<typeof Bun.spawn>;
    });
});

afterEach(() => spawn.mockRestore());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test('returns the absolute directory path using Bun', async () => {
    expect(await selectDirectory()).toBe(directory);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0][0]).toBe('osascript');
    expect(spawn.mock.calls[0][1]?.timeout).toBe(180_000);
});

test('returns null when the picker is cancelled', async () => {
    output = '\n';
    expect(await selectDirectory()).toBeNull();
});

test('rejects a relative path', async () => {
    output = 'workspace';
    await expect(selectDirectory()).rejects.toThrow('absolute path');
});

test('reports a failed native picker', async () => {
    failure = new Error('Picker unavailable');
    await expect(selectDirectory()).rejects.toThrow('Picker unavailable');
});

test('rejects a failed or timed-out subprocess', async () => {
    exitCode = 137;
    await expect(selectDirectory()).rejects.toThrow('Could not open');
});

test('rejects a file instead of a directory', async () => {
    const file = join(directory, 'profile.md');
    writeFileSync(file, 'profile');
    output = file + '\n';
    await expect(selectDirectory()).rejects.toThrow('not a directory');
});

test('preserves spaces at the end of a directory name', async () => {
    const path = join(directory, 'workspace ');
    mkdirSync(path);
    output = path + '\n';
    expect(await selectDirectory()).toBe(path);
});

test.each([
    ['win32', 'powershell.exe'],
    ['linux', 'zenity'],
] satisfies [NodeJS.Platform, string][])('uses the native picker for %s', async (platform, command) => {
    os = platform;
    expect(await selectDirectory()).toBe(directory);
    expect(spawn.mock.calls[0][0][0]).toBe(command);
});

test('handles Linux picker cancellation', async () => {
    os = 'linux';
    exitCode = 1;
    output = '';
    expect(await selectDirectory()).toBeNull();
});

const rejectedRequests: Record<string, string>[] = [
    { host: 'example.com', origin: 'http://example.com' },
    { host: 'localhost:3000', origin: 'https://example.com' },
    { host: 'localhost:3000' },
];

test.each(rejectedRequests)(
    'rejects nonlocal or cross-origin requests before opening the picker: %j',
    async (values) => {
        requestHeaders = new Headers(values);
        await expect(selectDirectory()).rejects.toThrow('local app');
        expect(spawn).not.toHaveBeenCalled();
    },
);

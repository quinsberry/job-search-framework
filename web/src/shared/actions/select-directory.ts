'use server';

import { realpath, stat } from 'node:fs/promises';
import { platform } from 'node:os';
import { isAbsolute } from 'node:path';
import { headers } from 'next/headers';

const pickerCommands: Partial<Record<NodeJS.Platform, string[]>> = {
    darwin: [
        'osascript', '-e',
        'try\nreturn POSIX path of (choose folder with prompt "Select your job-search workspace")\non error number -128\nreturn ""\nend try',
    ],
    win32: [
        'powershell.exe', '-NoProfile', '-STA', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; try { if ($dialog.ShowDialog() -eq "OK") { [Console]::WriteLine($dialog.SelectedPath) } } finally { $dialog.Dispose() }',
    ],
    linux: ['zenity', '--file-selection', '--directory', '--title=Select your job-search workspace'],
};

export async function selectDirectory(): Promise<string | null> {
    const requestHeaders = await headers();
    const host = requestHeaders.get('host');
    const origin = requestHeaders.get('origin');
    const hostname = host ? new URL(`http://${host}`).hostname : '';

    if (
        !['localhost', '127.0.0.1', '[::1]'].includes(hostname) ||
        !origin ||
        ![`http://${host}`, `https://${host}`].includes(origin)
    ) {
        throw new Error('Folder selection is only available from the local app.');
    }

    const os = platform();
    const command = pickerCommands[os];
    if (!command) throw new Error('Native folder selection is unavailable on this platform.');

    const picker = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', timeout: 180_000 });
    const [stdout, , exitCode] = await Promise.all([
        new Response(picker.stdout).text(),
        new Response(picker.stderr).text(),
        picker.exited,
    ]);
    if (os === 'linux' && exitCode === 1) return null;
    if (exitCode !== 0) throw new Error('Could not open the native folder picker.');

    const path = stdout.replace(/\r?\n$/, '');
    if (!path) return null;
    if (!isAbsolute(path)) {
        throw new Error('The folder picker did not return an absolute path.');
    }
    const absolutePath = await realpath(path);
    if (!(await stat(absolutePath)).isDirectory()) {
        throw new Error('The selected path is not a directory.');
    }
    return absolutePath;
}

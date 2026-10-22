import { YAML } from 'bun';
import { appendFile, lstat, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

export const digest = (value: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export class StorageError extends Error {
	constructor(
		public code: 'invalid' | 'conflict',
		message: string,
	) {
		super(message);
	}
}
export function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export class WorkspaceFiles {
	private constructor(
		readonly workspace: string,
		private root: string,
	) {}
	static async open(workspace: string, namespace: string) {
		if (!isAbsolute(workspace)) throw new StorageError('invalid', 'Select an absolute workspace folder.');
		if (!/^[a-z-]+$/.test(namespace)) throw new StorageError('invalid', 'Invalid storage namespace.');
		const resolved = await realpath(workspace);
		if (!(await stat(resolved)).isDirectory()) throw new StorageError('invalid', 'Workspace must be a folder.');
		const root = join(resolved, namespace);
		await mkdir(root, { recursive: true });
		if ((await lstat(root)).isSymbolicLink())
			throw new StorageError('invalid', 'Workspace storage cannot use symbolic links.');
		return new WorkspaceFiles(resolved, root);
	}
	private async path(name: string) {
		const path = join(this.root, name);
		const rel = relative(this.root, path);
		if (rel.startsWith('..') || isAbsolute(rel)) throw new StorageError('invalid', 'Invalid storage path.');
		let current = this.workspace;
		for (const part of relative(this.workspace, path).split(sep)) {
			current = join(current, part);
			try {
				if ((await lstat(current)).isSymbolicLink())
					throw new StorageError('invalid', 'Workspace storage cannot use symbolic links.');
			} catch (error) {
				if (!missing(error)) throw error;
			}
		}
		return path;
	}
	async read(name: string): Promise<string | null> {
		try {
			return await Bun.file(await this.path(name)).text();
		} catch (error) {
			if (missing(error)) return null;
			throw error;
		}
	}
	async write(name: string, value: unknown) {
		await this.writeBytes(name, YAML.stringify(value, null, 2));
	}
	async writeBytes(name: string, bytes: string | Uint8Array) {
		const path = await this.path(name);
		await mkdir(join(path, '..'), { recursive: true });
		await this.path(name);
		const temporary = path + '.' + crypto.randomUUID() + '.tmp';
		try {
			// Bun.write has no exclusive-create flag; retain wx and rename for atomic publication.
			await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	async append(name: string, text: string) {
		await appendFile(await this.path(name), text, { mode: 0o600 });
	}
	async readBytes(name: string) {
		return new Uint8Array(await Bun.file(await this.path(name)).arrayBuffer());
	}
	async lock<T>(action: () => Promise<T>): Promise<T> {
		const lock = await this.path('.lock');
		for (let attempt = 0; ; attempt++) {
			try {
				await mkdir(lock);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				try {
					const owner = await this.read('.lock/owner');
					if (owner ? !alive(Number(owner)) : Date.now() - (await stat(lock)).mtimeMs > 5000) {
						await rm(lock, { recursive: true, force: true });
						continue;
					}
				} catch (error) {
					if (missing(error)) continue;
					throw error;
				}
				if (attempt >= 100) throw new StorageError('conflict', 'Workspace storage is busy. Please retry.');
				await Bun.sleep(20);
			}
		}
		try {
			await writeFile(join(lock, 'owner'), String(process.pid));
			return await action();
		} finally {
			await rm(lock, { recursive: true, force: true });
		}
	}
}

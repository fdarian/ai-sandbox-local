import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalSandboxSession } from '#src/local-sandbox-session.ts';
import {
	cleanupTempDir,
	makeTempDir,
	spawnWithGrandchild,
	waitForProcessGone,
} from './fixtures.ts';

async function readPidFile(path: string): Promise<number> {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		const pid = Number.parseInt(
			await readFile(path, 'utf-8').catch(() => ''),
			10,
		);
		if (Number.isInteger(pid)) return pid;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`No pid appeared in ${path} within 3s.`);
}

describe('LocalSandboxSession', () => {
	test('writeTextFile / readTextFile round-trips through the real filesystem', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			await session.writeTextFile({
				path: 'hello.txt',
				content: 'hello world\n',
			});

			// Prove it landed on the real disk, not just some in-memory model.
			const onDisk = await readFile(join(dir, 'hello.txt'), 'utf-8');
			expect(onDisk).toBe('hello world\n');

			const readBack = await session.readTextFile({ path: 'hello.txt' });
			expect(readBack).toBe('hello world\n');
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('writeTextFile creates parent directories recursively', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			await session.writeTextFile({
				path: 'nested/deeper/file.txt',
				content: 'x',
			});
			expect(
				await session.readTextFile({ path: 'nested/deeper/file.txt' }),
			).toBe('x');
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('writeBinaryFile / readBinaryFile round-trips raw bytes', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const bytes = new Uint8Array([0, 1, 2, 255, 254]);
			await session.writeBinaryFile({ path: 'bin.dat', content: bytes });
			const readBack = await session.readBinaryFile({ path: 'bin.dat' });
			expect(readBack).toEqual(bytes);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('readTextFile returns null for a missing file', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			expect(await session.readTextFile({ path: 'missing.txt' })).toBeNull();
			expect(await session.readBinaryFile({ path: 'missing.txt' })).toBeNull();
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("readTextFile resolves relative paths against the session's cwd", async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			await session.writeTextFile({
				path: 'a.txt',
				content: 'line1\nline2\nline3\n',
			});
			expect(
				await session.readTextFile({
					path: 'a.txt',
					startLine: 2,
					endLine: 2,
				}),
			).toBe('line2');
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("run executes a real shell command in the session's cwd and captures stdout/stderr/exit code", async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const result = await session.run({
				command: 'echo out-line && echo err-line 1>&2 && pwd',
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('out-line');
			expect(result.stdout.trim().endsWith(dir.replace(/\/$/, ''))).toBe(true);
			expect(result.stderr).toContain('err-line');
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('run reports a non-zero exit code', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const result = await session.run({ command: 'exit 7' });
			expect(result.exitCode).toBe(7);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('run honors an explicit workingDirectory and env override', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const result = await session.run({
				command: 'pwd && echo $MY_VAR',
				workingDirectory: '/tmp',
				env: { MY_VAR: 'sentinel' },
			});
			expect(result.stdout).toContain('sentinel');
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('spawn streams stdout live and reports the exit code on wait()', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const proc = await session.spawn({
				command: 'echo first && sleep 0.05 && echo second',
			});

			const reader = proc.stdout.getReader();
			const decoder = new TextDecoder();
			let collected = '';
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				collected += decoder.decode(chunk.value);
			}

			const exit = await proc.wait();
			expect(exit.exitCode).toBe(0);
			expect(collected).toBe('first\nsecond\n');
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("spawn's kill() terminates a long-running process", async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const proc = await session.spawn({ command: 'sleep 30' });
			expect(typeof proc.pid).toBe('number');

			await proc.kill();
			const exit = await proc.wait();

			// Killed by SIGTERM: shell convention is 128 + signal number.
			expect(exit.exitCode).toBe(143);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("spawn's kill() also kills the process's descendants", async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const { proc, grandchildPid } = await spawnWithGrandchild(session);

			await proc.kill();
			expect((await proc.wait()).exitCode).toBe(143);
			await waitForProcessGone(grandchildPid);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("an aborted signal kills the spawned process's descendants and rejects wait()", async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const controller = new AbortController();
			const { proc, grandchildPid } = await spawnWithGrandchild(
				session,
				controller.signal,
			);

			const waiting = proc.wait();
			controller.abort();
			await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
			await waitForProcessGone(grandchildPid);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('an aborted signal ends a run() and kills its descendants', async () => {
		const dir = await makeTempDir();
		try {
			const session = new LocalSandboxSession(dir);
			const controller = new AbortController();
			const running = session.run({
				command: '(sleep 1000 & echo $! > pid; wait) & wait',
				abortSignal: controller.signal,
			});
			const grandchildPid = await readPidFile(join(dir, 'pid'));

			controller.abort();
			await expect(running).rejects.toMatchObject({ name: 'AbortError' });
			await waitForProcessGone(grandchildPid);
		} finally {
			await cleanupTempDir(dir);
		}
	});
});

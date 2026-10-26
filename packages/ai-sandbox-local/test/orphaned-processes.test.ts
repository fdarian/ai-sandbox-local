import { afterEach, describe, expect, test } from 'bun:test';
import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils';
import { createLocalSandboxSession } from '#src/create-local-sandbox-session.ts';
import { cleanupTempDir, makeTempDir, waitForProcessGone } from './fixtures.ts';

// Not `sleep`: macOS hides the environment of SIP-protected platform binaries.
const ORPHAN_COMMAND =
	"node -e 'setInterval(() => {}, 1000)' </dev/null >/dev/null 2>&1 & echo $!";

const orphanPids: number[] = [];

afterEach(() => {
	for (const pid of orphanPids.splice(0)) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
		}
	}
});

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
		throw error;
	}
};

const parsePid = (stdout: string): number => {
	const pid = Number(stdout.trim());
	if (!Number.isInteger(pid)) {
		throw new Error(`Expected a pid, got ${JSON.stringify(stdout)}.`);
	}
	orphanPids.push(pid);
	return pid;
};

/** Leaves a `node` process alive after its shell exited, reparented to PID 1. */
const orphanViaSpawn = async (
	surface: Pick<Experimental_SandboxSession, 'spawn'>,
): Promise<number> => {
	const proc = await surface.spawn({ command: ORPHAN_COMMAND });
	const stdout = await new Response(proc.stdout).text();
	await proc.wait();
	return parsePid(stdout);
};

const orphanViaRun = async (
	surface: Pick<Experimental_SandboxSession, 'run'>,
): Promise<number> =>
	parsePid((await surface.run({ command: ORPHAN_COMMAND })).stdout);

describe('processes orphaned before stop()', () => {
	for (const [name, orphan] of [
		['spawn', orphanViaSpawn],
		['run', orphanViaRun],
	] as const) {
		test(`stop() kills an orphan left by ${name}()`, async () => {
			const workingDirectory = await makeTempDir();
			try {
				const session = await createLocalSandboxSession({ workingDirectory });
				const pid = await orphan(session.restricted());
				expect(isAlive(pid)).toBe(true);
				await session.stop();
				await waitForProcessGone(pid);
			} finally {
				await cleanupTempDir(workingDirectory);
			}
		});
	}

	test("stopping one session leaves another session's orphan alone", async () => {
		const dirA = await makeTempDir();
		const dirB = await makeTempDir();
		try {
			const a = await createLocalSandboxSession({ workingDirectory: dirA });
			const b = await createLocalSandboxSession({ workingDirectory: dirB });
			const pidA = await orphanViaSpawn(a);
			const pidB = await orphanViaSpawn(b);
			await a.stop();
			await waitForProcessGone(pidA);
			expect(isAlive(pidB)).toBe(true);
			await b.stop();
			await waitForProcessGone(pidB);
		} finally {
			await cleanupTempDir(dirA);
			await cleanupTempDir(dirB);
		}
	});

	test("a process's kill() does not reach an unrelated orphan of the same session", async () => {
		const workingDirectory = await makeTempDir();
		try {
			const session = await createLocalSandboxSession({ workingDirectory });
			const orphanPid = await orphanViaSpawn(session);
			const other = await session.spawn({ command: 'sleep 30' });
			await other.kill();
			expect((await other.wait()).exitCode).toBe(143);
			expect(isAlive(orphanPid)).toBe(true);
			await session.stop();
			await waitForProcessGone(orphanPid);
		} finally {
			await cleanupTempDir(workingDirectory);
		}
	});

	test("a caller's env cannot override the session marker", async () => {
		const workingDirectory = await makeTempDir();
		try {
			const session = await createLocalSandboxSession({ workingDirectory });
			const stdout = (
				await session.run({
					command: 'echo $AI_SANDBOX_LOCAL_SESSION_ID',
					env: { AI_SANDBOX_LOCAL_SESSION_ID: 'forged' },
				})
			).stdout.trim();
			expect(stdout).not.toBe('forged');
			expect(stdout).not.toBe('');
			await session.stop();
		} finally {
			await cleanupTempDir(workingDirectory);
		}
	});
});

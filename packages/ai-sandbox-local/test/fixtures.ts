import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
	Experimental_SandboxProcess,
	Experimental_SandboxSession,
} from '@ai-sdk/provider-utils';

/** A throwaway directory for a test to use as a session's `defaultWorkingDirectory`. */
export const makeTempDir = (): Promise<string> =>
	mkdtemp(join(tmpdir(), 'ai-sandbox-local-test-'));

export const cleanupTempDir = (dir: string): Promise<void> =>
	rm(dir, { recursive: true, force: true });

/**
 * Starts a shell whose descendant (two levels down) is a long `sleep` and
 * returns that `sleep`'s pid, so a test can check it dies with the tree.
 */
export async function spawnWithGrandchild(
	session: Pick<Experimental_SandboxSession, 'spawn'>,
	abortSignal?: AbortSignal,
): Promise<{ proc: Experimental_SandboxProcess; grandchildPid: number }> {
	const proc = await session.spawn({
		command: '(sleep 1000 & echo $!; wait) & wait',
		abortSignal,
	});
	const reader = proc.stdout.getReader();
	const first = await reader.read();
	reader.releaseLock();
	if (first.value === undefined) {
		throw new Error('Process exited before reporting its grandchild pid.');
	}
	const grandchildPid = Number(new TextDecoder().decode(first.value).trim());
	if (!Number.isInteger(grandchildPid)) {
		throw new Error('Process did not report a numeric grandchild pid.');
	}
	return { proc, grandchildPid };
}

/** Polls until `pid` no longer exists, since `SIGTERM` delivery is asynchronous. */
export async function waitForProcessGone(pid: number): Promise<void> {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
			throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Process ${pid} was still running after 3s.`);
}

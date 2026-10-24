import { describe, expect, test } from 'bun:test';
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import { LocalSandboxProvider } from '#src/local-sandbox-provider.ts';
import { cleanupTempDir, makeTempDir } from './fixtures.ts';

describe('LocalSandboxProvider', () => {
	test("createSession's defaultWorkingDirectory is the real, already-existing directory", async () => {
		const dir = await makeTempDir();
		try {
			const provider = new LocalSandboxProvider({
				defaultWorkingDirectory: dir,
			});
			const session = await provider.createSession();
			try {
				expect(session.defaultWorkingDirectory).toBe(dir);
				expect(session.id).toBeTruthy();
				expect(session.ports).toHaveLength(1);

				const url = await session.getPortUrl({
					port: session.ports[0] as number,
					protocol: 'ws',
				});
				expect(url).toBe(`ws://127.0.0.1:${session.ports[0]}`);
			} finally {
				await session.stop();
			}
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('restricted() shares the same cwd but exposes no infra members', async () => {
		const dir = await makeTempDir();
		try {
			const provider = new LocalSandboxProvider({
				defaultWorkingDirectory: dir,
			});
			const session = await provider.createSession();
			try {
				const restricted = session.restricted();
				expect('stop' in restricted).toBe(false);
				expect('getPortUrl' in restricted).toBe(false);

				await restricted.writeTextFile({
					path: 'a.txt',
					content: 'hi',
				});
				expect(await session.readTextFile({ path: 'a.txt' })).toBe('hi');
			} finally {
				await session.stop();
			}
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('two concurrent sessions on independent providers lease distinct, non-colliding ports', async () => {
		const dirA = await makeTempDir();
		const dirB = await makeTempDir();
		try {
			const providerA = new LocalSandboxProvider({
				defaultWorkingDirectory: dirA,
			});
			const providerB = new LocalSandboxProvider({
				defaultWorkingDirectory: dirB,
			});

			const [sessionA, sessionB] = await Promise.all([
				providerA.createSession(),
				providerB.createSession(),
			]);
			try {
				expect(sessionA.ports[0]).not.toBe(sessionB.ports[0]);
			} finally {
				await Promise.all([sessionA.stop(), sessionB.stop()]);
			}
		} finally {
			await Promise.all([cleanupTempDir(dirA), cleanupTempDir(dirB)]);
		}
	});

	test('stop() is idempotent', async () => {
		const dir = await makeTempDir();
		try {
			const provider = new LocalSandboxProvider({
				defaultWorkingDirectory: dir,
			});
			const session = await provider.createSession();
			await session.stop();
			await session.stop();
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('createSession returns a HarnessV1NetworkSandboxSession usable as agent.createSession({ sandboxSession })', async () => {
		const dir = await makeTempDir();
		try {
			const provider = new LocalSandboxProvider({
				defaultWorkingDirectory: dir,
			});
			const session: HarnessV1NetworkSandboxSession =
				await provider.createSession();

			const port = session.ports[0] as number;
			expect(await session.getPortEndpoint({ port, protocol: 'ws' })).toEqual({
				url: `ws://127.0.0.1:${port}`,
			});
			expect(await session.getPortEndpoint({ port })).toEqual({
				url: `http://127.0.0.1:${port}`,
			});

			const proc = await session.spawn({ command: 'sleep 30' });
			await session.destroy();
			expect((await proc.wait()).exitCode).toBe(143);
			await session.destroy();
		} finally {
			await cleanupTempDir(dir);
		}
	});
});

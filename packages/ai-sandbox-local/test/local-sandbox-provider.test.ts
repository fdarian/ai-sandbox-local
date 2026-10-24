import { describe, expect, spyOn, test } from 'bun:test';
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import {
	createLocalSandboxProvider,
	LocalSandboxProvider,
} from '#src/local-sandbox-provider.ts';
import * as portModule from '#src/port.ts';
import { cleanupTempDir, makeTempDir } from './fixtures.ts';

describe('LocalSandboxProvider', () => {
	test("createSession's defaultWorkingDirectory is the real, already-existing directory", async () => {
		const dir = await makeTempDir();
		try {
			const provider = new LocalSandboxProvider({
				workingDirectory: dir,
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
				workingDirectory: dir,
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
				workingDirectory: dirA,
			});
			const providerB = new LocalSandboxProvider({
				workingDirectory: dirB,
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
				workingDirectory: dir,
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
			const provider = createLocalSandboxProvider({ workingDirectory: dir });
			const session: HarnessV1NetworkSandboxSession =
				await provider.createSession();
			try {
				const port = session.ports[0] as number;
				expect(await session.getPortEndpoint({ port, protocol: 'ws' })).toEqual(
					{ url: `ws://127.0.0.1:${port}` },
				);
			} finally {
				await session.destroy();
			}
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test('onFirstCreate runs against the restricted session and its failure stops the session', async () => {
		const dir = await makeTempDir();
		try {
			const provider = createLocalSandboxProvider({ workingDirectory: dir });

			const seen: { restricted?: object } = {};
			const ok = await provider.createSession({
				onFirstCreate: async (restricted) => {
					seen.restricted = restricted;
					await restricted.writeTextFile({ path: 'seed.txt', content: 'x' });
				},
			});
			try {
				expect('stop' in (seen.restricted as object)).toBe(false);
				expect(await ok.readTextFile({ path: 'seed.txt' })).toBe('x');
			} finally {
				await ok.stop();
			}

			const releasePortSpy = spyOn(portModule, 'releasePort');
			const failure = new Error('bootstrap failed');
			try {
				await expect(
					provider.createSession({
						onFirstCreate: async () => {
							throw failure;
						},
					}),
				).rejects.toBe(failure);
				expect(releasePortSpy).toHaveBeenCalledTimes(1);
			} finally {
				releasePortSpy.mockRestore();
			}
		} finally {
			await cleanupTempDir(dir);
		}
	});
});

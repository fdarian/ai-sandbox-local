import { describe, expect, test } from 'bun:test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalSandboxSession } from '#src/create-local-sandbox-session.ts';
import { cleanupTempDir, makeTempDir } from './fixtures.ts';

describe('createLocalSandboxSession', () => {
	test('roots the session at workingDirectory, creating it when missing', async () => {
		const root = await makeTempDir();
		const workingDirectory = join(root, 'nested', 'repo');
		try {
			const session = await createLocalSandboxSession({ workingDirectory });
			try {
				expect(session.defaultWorkingDirectory).toBe(workingDirectory);
				expect((await stat(workingDirectory)).isDirectory()).toBe(true);
				expect(session.ports).toHaveLength(1);
			} finally {
				await session.stop();
			}
		} finally {
			await cleanupTempDir(root);
		}
	});

	test("resolves '.'-style workDir paths against workingDirectory", async () => {
		const workingDirectory = await makeTempDir();
		try {
			const session = await createLocalSandboxSession({ workingDirectory });
			try {
				await session.writeTextFile({ path: './a.txt', content: 'hi' });
				const result = await session.run({ command: 'cat a.txt' });
				expect(result.stdout).toBe('hi');
			} finally {
				await session.stop();
			}
		} finally {
			await cleanupTempDir(workingDirectory);
		}
	});

	test('rejects an already-aborted signal without creating the directory', async () => {
		const root = await makeTempDir();
		const workingDirectory = join(root, 'never');
		try {
			await expect(
				createLocalSandboxSession({
					workingDirectory,
					abortSignal: AbortSignal.abort(),
				}),
			).rejects.toThrow();
			await expect(stat(workingDirectory)).rejects.toThrow();
		} finally {
			await cleanupTempDir(root);
		}
	});

	test('env reaches run and spawn, overrides process.env, and loses to the per-call env', async () => {
		const workingDirectory = await makeTempDir();
		process.env.AI_SANDBOX_LOCAL_TEST_VAR = 'from-process';
		try {
			const session = await createLocalSandboxSession({
				workingDirectory,
				env: {
					AI_SANDBOX_LOCAL_TEST_VAR: 'from-settings',
					AI_SANDBOX_LOCAL_ONLY_SETTINGS: 'settings-only',
				},
			});
			try {
				const read =
					'echo "$AI_SANDBOX_LOCAL_TEST_VAR/$AI_SANDBOX_LOCAL_ONLY_SETTINGS"';

				const run = await session.run({ command: read });
				expect(run.stdout.trim()).toBe('from-settings/settings-only');

				const overridden = await session.run({
					command: read,
					env: { AI_SANDBOX_LOCAL_TEST_VAR: 'from-call' },
				});
				expect(overridden.stdout.trim()).toBe('from-call/settings-only');

				const spawned = await session.spawn({ command: read });
				const output = await new Response(spawned.stdout).text();
				expect(output.trim()).toBe('from-settings/settings-only');
			} finally {
				await session.stop();
			}
		} finally {
			delete process.env.AI_SANDBOX_LOCAL_TEST_VAR;
			await cleanupTempDir(workingDirectory);
		}
	});

	test('env is carried into restricted() sessions', async () => {
		const workingDirectory = await makeTempDir();
		try {
			const session = await createLocalSandboxSession({
				workingDirectory,
				env: { AI_SANDBOX_LOCAL_RESTRICTED_VAR: 'kept' },
			});
			try {
				const result = await session
					.restricted()
					.run({ command: 'echo "$AI_SANDBOX_LOCAL_RESTRICTED_VAR"' });
				expect(result.stdout.trim()).toBe('kept');
			} finally {
				await session.stop();
			}
		} finally {
			await cleanupTempDir(workingDirectory);
		}
	});

	test('getPortEndpoint resolves to loopback and destroy() kills spawned processes idempotently', async () => {
		const workingDirectory = await makeTempDir();
		try {
			const session = await createLocalSandboxSession({ workingDirectory });

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
			await cleanupTempDir(workingDirectory);
		}
	});
});

import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LocalNetworkSandboxSession } from '#src/local-network-sandbox-session.ts';
import { allocatePort } from '#src/port.ts';

export type LocalSandboxSessionOptions = {
	/** Created with `mkdir -p` if missing. The agent works directly in it when `sandboxConfig.workDir` is `'.'`. */
	readonly workingDirectory: string;
	/**
	 * The `HOME` every `run`/`spawn` sees, which is where the harness keeps its
	 * state (`.ai-sdk-harness`, skills). Created with `mkdir -p`. Defaults to a
	 * directory under the OS temp dir shared by all sessions, so the first-run
	 * CLI install stays warm; pass `os.homedir()` to use your real home.
	 */
	readonly homeDirectory?: string;
	/**
	 * Extra environment for every `run`/`spawn` in the sandbox, layered over
	 * `process.env` and `homeDirectory`. `env.HOME` beats `homeDirectory`. A
	 * per-call `env` still wins.
	 */
	readonly env?: Readonly<Record<string, string>>;
	readonly abortSignal?: AbortSignal;
};

const defaultHomeDirectory = () => join(tmpdir(), 'ai-sandbox-local', 'home');

export async function createLocalSandboxSession(
	options: LocalSandboxSessionOptions,
): Promise<LocalNetworkSandboxSession> {
	options.abortSignal?.throwIfAborted();

	const defaultWorkingDirectory = resolve(options.workingDirectory);
	await mkdir(defaultWorkingDirectory, { recursive: true });

	const homeDirectory = resolve(
		options.homeDirectory ?? defaultHomeDirectory(),
	);
	await mkdir(homeDirectory, { recursive: true });

	const port = await allocatePort();
	return new LocalNetworkSandboxSession({
		defaultWorkingDirectory,
		port,
		env: { HOME: homeDirectory, ...options.env },
	});
}

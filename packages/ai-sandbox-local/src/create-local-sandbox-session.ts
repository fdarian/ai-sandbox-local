import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LocalNetworkSandboxSession } from '#src/local-network-sandbox-session.ts';
import { allocatePort } from '#src/port.ts';

export type LocalSandboxSessionOptions = {
	/** Created with `mkdir -p` if missing. The agent works directly in it when `sandboxConfig.workDir` is `'.'`. */
	readonly workingDirectory: string;
	/**
	 * Extra environment for every `run`/`spawn` in the sandbox, layered over
	 * `process.env` (e.g. a `HOME` that points at persistent storage). A
	 * per-call `env` still wins.
	 */
	readonly env?: Readonly<Record<string, string>>;
	readonly abortSignal?: AbortSignal;
};

export async function createLocalSandboxSession(
	options: LocalSandboxSessionOptions,
): Promise<LocalNetworkSandboxSession> {
	options.abortSignal?.throwIfAborted();

	const defaultWorkingDirectory = resolve(options.workingDirectory);
	await mkdir(defaultWorkingDirectory, { recursive: true });

	const port = await allocatePort();
	return new LocalNetworkSandboxSession({
		defaultWorkingDirectory,
		port,
		env: options.env,
	});
}

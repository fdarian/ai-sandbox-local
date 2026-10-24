import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
	type Experimental_SandboxProcess,
	type Experimental_SandboxSession,
	extractLines,
} from '@ai-sdk/provider-utils';
import { isEnoent } from '#src/is-enoent.ts';
import { ProcessRegistry } from '#src/process-registry.ts';
import { toSandboxProcess } from '#src/sandbox-process.ts';
import { bytesToStream, collectStream } from '#src/stream-utils.ts';

type RunOptions = Parameters<Experimental_SandboxSession['run']>[0];
type SpawnOptions = Parameters<Experimental_SandboxSession['spawn']>[0];
type ReadFileOptions = Parameters<Experimental_SandboxSession['readFile']>[0];
type ReadTextFileOptions = Parameters<
	Experimental_SandboxSession['readTextFile']
>[0];
type WriteFileOptions = Parameters<Experimental_SandboxSession['writeFile']>[0];
type WriteBinaryFileOptions = Parameters<
	Experimental_SandboxSession['writeBinaryFile']
>[0];
type WriteTextFileOptions = Parameters<
	Experimental_SandboxSession['writeTextFile']
>[0];

/**
 * pnpm ≥10 gates dependency build scripts (postinstall, etc.) behind an
 * interactive `pnpm approve-builds` unless this is set — which every harness
 * adapter's pinned-CLI bootstrap install trips on its very first run,
 * since there's no TTY here to approve through and the bootstrap
 * directory's path isn't ours to choose (see AGENTS.md, "Gotchas"). Setting it via env instead
 * of writing a config file works regardless of what path a given adapter
 * happens to bootstrap into.
 *
 * All three spellings are set because pnpm's env-var config prefix changed
 * across versions (`npm_config_*` pre-v11, `pnpm_config_*`/`PNPM_CONFIG_*`
 * from v11) — verified against pnpm 11.17 on 2026-07-28; harmless on
 * versions that don't recognize the key (pnpm ignores unknown config) and a
 * no-op on pnpm <10, which never gated builds at all.
 */
const PNPM_BUILD_APPROVAL_ENV = {
	npm_config_dangerously_allow_all_builds: 'true',
	pnpm_config_dangerously_allow_all_builds: 'true',
	PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS: 'true',
};

/**
 * `run`/`spawn`'s `command` is an arbitrary shell string composed by the
 * harness adapter, so `PATH` is inherited from `process.env` untouched.
 *
 * `sandboxEnv` (the provider's `env` setting) overrides `process.env`, and
 * the per-call `callerEnv` is merged last so an adapter can still override
 * anything here deliberately, `PATH` included.
 */
const spawnEnv = (
	sandboxEnv: Readonly<Record<string, string>> | undefined,
	callerEnv: Readonly<Record<string, string>> | undefined,
): Record<string, string | undefined> => ({
	...PNPM_BUILD_APPROVAL_ENV,
	...process.env,
	...sandboxEnv,
	...callerEnv,
});

/**
 * `Experimental_SandboxSession` over the real filesystem and a real shell —
 * `run`/`spawn` shell out via `node:child_process`, file I/O goes through
 * `node:fs/promises`. This is the tool-safe surface returned by
 * `LocalNetworkSandboxSession.restricted()`; it holds no infra members
 * (no `stop`/`destroy`/`getPortUrl`), just exec + file I/O against `cwd`.
 * Every `run`/`spawn` child is tracked in `processes`, which a restricted
 * view shares with its network session so the session can kill them.
 */
export class LocalSandboxSession implements Experimental_SandboxSession {
	constructor(
		protected readonly cwd: string,
		protected readonly sandboxEnv?: Readonly<Record<string, string>>,
		protected readonly processes: ProcessRegistry = new ProcessRegistry(),
	) {}

	get description(): string {
		return [
			'Local sandbox: the real host filesystem and a real shell (bash), not a virtual one.',
			"Files written here and processes spawned here are the actual host's — this is the user's own worktree.",
			`Current working directory: ${this.cwd}`,
		].join('\n');
	}

	private resolvePath(path: string): string {
		return isAbsolute(path) ? path : resolve(this.cwd, path);
	}

	async run(options: RunOptions): Promise<{
		exitCode: number;
		stdout: string;
		stderr: string;
	}> {
		options.abortSignal?.throwIfAborted();

		const child = this.startShell(options);

		/*
		 * `run` is `spawn` plus draining both streams to strings — built on the
		 * same wrapper so a killed-by-signal exit code (128 + signum) is computed
		 * identically in both. Streams must be read via `collectStream`, not a
		 * manual `'data'` listener race against `toSandboxProcess`'s own
		 * `Readable.toWeb`, which would otherwise fight over the same source.
		 */
		const sandboxProcess = toSandboxProcess(child, options.abortSignal);
		const [stdout, stderr, exit] = await Promise.all([
			collectStream(sandboxProcess.stdout).then((bytes) =>
				Buffer.from(bytes).toString('utf-8'),
			),
			collectStream(sandboxProcess.stderr).then((bytes) =>
				Buffer.from(bytes).toString('utf-8'),
			),
			sandboxProcess.wait(),
		]);

		return { exitCode: exit.exitCode, stdout, stderr };
	}

	async spawn(options: SpawnOptions): Promise<Experimental_SandboxProcess> {
		options.abortSignal?.throwIfAborted();
		return toSandboxProcess(this.startShell(options), options.abortSignal);
	}

	private startShell(options: RunOptions | SpawnOptions): ChildProcess {
		const child = spawn('/bin/bash', ['-c', options.command], {
			cwd: options.workingDirectory ?? this.cwd,
			env: spawnEnv(this.sandboxEnv, options.env),
			stdio: ['ignore', 'pipe', 'pipe'],
			signal: options.abortSignal,
		});
		this.processes.track(child);
		return child;
	}

	async readFile(
		options: ReadFileOptions,
	): Promise<ReadableStream<Uint8Array> | null> {
		const bytes = await this.readBinaryFile(options);
		return bytes == null ? null : bytesToStream(bytes);
	}

	async readBinaryFile(options: ReadFileOptions): Promise<Uint8Array | null> {
		options.abortSignal?.throwIfAborted();
		const resolved = this.resolvePath(options.path);
		try {
			const buffer = await readFile(resolved);
			return new Uint8Array(
				buffer.buffer,
				buffer.byteOffset,
				buffer.byteLength,
			);
		} catch (error) {
			if (isEnoent(error)) return null;
			throw error;
		}
	}

	async readTextFile(options: ReadTextFileOptions): Promise<string | null> {
		const bytes = await this.readBinaryFile({
			path: options.path,
			abortSignal: options.abortSignal,
		});
		if (bytes == null) return null;
		const text = Buffer.from(bytes).toString(
			(options.encoding ?? 'utf-8') as BufferEncoding,
		);
		return extractLines({
			text,
			startLine: options.startLine,
			endLine: options.endLine,
		});
	}

	async writeFile(options: WriteFileOptions): Promise<void> {
		const bytes = await collectStream(options.content);
		await this.writeBinaryFile({
			path: options.path,
			content: bytes,
			abortSignal: options.abortSignal,
		});
	}

	async writeBinaryFile(options: WriteBinaryFileOptions): Promise<void> {
		options.abortSignal?.throwIfAborted();
		const resolved = this.resolvePath(options.path);
		await mkdir(dirname(resolved), { recursive: true });
		await writeFile(resolved, options.content);
	}

	async writeTextFile(options: WriteTextFileOptions): Promise<void> {
		const buffer = Buffer.from(
			options.content,
			(options.encoding ?? 'utf-8') as BufferEncoding,
		);
		await this.writeBinaryFile({
			path: options.path,
			content: new Uint8Array(
				buffer.buffer,
				buffer.byteOffset,
				buffer.byteLength,
			),
			abortSignal: options.abortSignal,
		});
	}
}

import { randomUUID } from 'node:crypto';
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils';
import { LocalSandboxSession } from '#src/local-sandbox-session.ts';
import { releasePort } from '#src/port.ts';
import { ProcessRegistry } from '#src/process-registry.ts';

type GetPortUrlOptions = Parameters<
	HarnessV1NetworkSandboxSession['getPortUrl']
>[0];
type GetPortEndpointOptions = Parameters<
	HarnessV1NetworkSandboxSession['getPortEndpoint']
>[0];

/**
 * `HarnessV1NetworkSandboxSession` over a real directory on disk. There is no
 * separate "sandbox resource" distinct from that directory plus one leased
 * loopback port — `stop`/`destroy` release the port and kill every process
 * started through this session or its `restricted()` views (in-flight `run`
 * calls included); they never touch the directory itself, since it's the
 * user's actual git worktree, not disposable sandbox state.
 *
 * `getPortUrl`/`getPortEndpoint` resolve to a bare loopback URL. There is no
 * network namespace to publish a port into — bridge-backed adapters connect
 * straight to the port a bridge process (spawned via `spawn()`) binds on this
 * same host.
 */
export class LocalNetworkSandboxSession
	extends LocalSandboxSession
	implements HarnessV1NetworkSandboxSession
{
	readonly id: string;
	readonly defaultWorkingDirectory: string;
	readonly ports: ReadonlyArray<number>;

	private readonly leasedPort: number;
	private stopped = false;

	constructor(options: {
		defaultWorkingDirectory: string;
		port: number;
		env?: Readonly<Record<string, string>>;
	}) {
		super(options.defaultWorkingDirectory, options.env, new ProcessRegistry());
		this.id = randomUUID();
		this.defaultWorkingDirectory = options.defaultWorkingDirectory;
		this.leasedPort = options.port;
		this.ports = [options.port];
	}

	/**
	 * Reduced view sharing this session's `cwd` but none of the infra surface
	 * — a fresh `LocalSandboxSession`, not `this`, so holders can't reach
	 * `stop`/`destroy`/`getPortUrl` through it. Matches
	 * `JustBashSandboxSession.restricted()`'s shape. It shares this session's
	 * process registry, so `stop()` kills what the view spawned or is running.
	 */
	restricted(): Experimental_SandboxSession {
		return new LocalSandboxSession(
			this.defaultWorkingDirectory,
			this.sandboxEnv,
			this.processes,
		);
	}

	getPortUrl = async (options: GetPortUrlOptions): Promise<string> => {
		const protocol = options.protocol ?? 'http';
		return `${protocol}://127.0.0.1:${options.port}`;
	};

	getPortEndpoint = async (
		options: GetPortEndpointOptions,
	): Promise<{ readonly url: string }> => {
		return { url: await this.getPortUrl(options) };
	};

	stop = async (): Promise<void> => {
		if (this.stopped) return;
		this.stopped = true;
		try {
			this.processes.killAll();
		} finally {
			releasePort(this.leasedPort);
		}
	};

	/**
	 * No separate destroy concept: the "sandbox" is the user's real worktree
	 * directory, which must survive the session regardless of how it ends.
	 * Declared anyway (rather than omitted) so callers that always call
	 * `destroy()` over `stop()` still release the port and owned processes.
	 */
	destroy = async (): Promise<void> => {
		await this.stop();
	};
}

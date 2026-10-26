import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { killSessionProcesses } from '#src/kill-process-tree.ts';

/**
 * Shared by a `LocalNetworkSandboxSession` and every `restricted()` view
 * built from it, so `stop()` reaches processes started through any of them
 * — the harness spawns its bridge through `restricted()`, not the network
 * session itself. Internal; not exported from the package entry.
 */
export class ProcessRegistry {
	/** Value of `SESSION_ID_ENV` on every process started through this registry. */
	readonly sessionId = randomUUID();
	private readonly children = new Set<ChildProcess>();

	track(child: ChildProcess): void {
		this.children.add(child);
		child.once('close', () => {
			this.children.delete(child);
		});
	}

	killAll(): void {
		killSessionProcesses(this.children, this.sessionId);
	}
}

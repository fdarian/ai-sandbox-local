import type { ChildProcess } from 'node:child_process';
import { killProcessTrees } from '#src/kill-process-tree.ts';

/**
 * Shared by a `LocalNetworkSandboxSession` and every `restricted()` view
 * built from it, so `stop()` reaches processes started through any of them
 * — the harness spawns its bridge through `restricted()`, not the network
 * session itself. Internal; not exported from the package entry.
 */
export class ProcessRegistry {
	private readonly children = new Set<ChildProcess>();

	track(child: ChildProcess): void {
		this.children.add(child);
		child.once('close', () => {
			this.children.delete(child);
		});
	}

	killAll(): void {
		killProcessTrees(this.children);
	}
}

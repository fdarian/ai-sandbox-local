import { type ChildProcess, execFileSync } from 'node:child_process';

/**
 * SIGTERMs `child` and its current descendants; a descendant whose parent
 * already exited was reparented to PID 1 and can't be found. Killing only the direct
 * `/bin/bash -c` child leaves its descendants (e.g. a bridge and the CLI
 * server it launched) running, reparented to PID 1.
 */
export function killProcessTree(child: ChildProcess): void {
	killProcessTrees([child]);
}

/**
 * Walks the process table once for all `children`, so a tree is never
 * partially signalled by an earlier kill reparenting its descendants.
 * Children are not made process-group leaders (`detached`) because that
 * would stop a terminal's Ctrl+C from reaching them.
 */
export function killProcessTrees(children: Iterable<ChildProcess>): void {
	const live = [...children].filter(
		(child) =>
			child.pid !== undefined &&
			child.exitCode === null &&
			child.signalCode === null,
	);
	if (live.length === 0) return;

	// Must precede every signal: once a parent dies, its children move to PID 1
	// and can no longer be traced back to it.
	const childrenByParent = readChildrenByParent();
	const descendants = live.flatMap((child) =>
		collectDescendants(childrenByParent, child.pid as number),
	);

	for (const pid of descendants) {
		signalIgnoringExited(pid);
	}
	for (const child of live) {
		child.kill('SIGTERM');
	}
}

function readChildrenByParent(): Map<number, number[]> {
	// Throws if `ps` fails: the alternative is silently leaving grandchildren running.
	const output = execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
		encoding: 'utf-8',
	});

	const childrenByParent = new Map<number, number[]>();
	for (const line of output.split('\n')) {
		if (line.trim() === '') continue;
		const [pid, ppid] = line.trim().split(/\s+/).map(Number);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
			throw new Error(`Unexpected 'ps' output line: ${JSON.stringify(line)}`);
		}
		const siblings = childrenByParent.get(ppid as number);
		if (siblings === undefined) {
			childrenByParent.set(ppid as number, [pid as number]);
		} else {
			siblings.push(pid as number);
		}
	}
	return childrenByParent;
}

function collectDescendants(
	childrenByParent: Map<number, number[]>,
	root: number,
): number[] {
	const descendants: number[] = [];
	const queue = [root];
	for (const parent of queue) {
		for (const pid of childrenByParent.get(parent) ?? []) {
			descendants.push(pid);
			queue.push(pid);
		}
	}
	return descendants;
}

function signalIgnoringExited(pid: number): void {
	try {
		process.kill(pid, 'SIGTERM');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
	}
}

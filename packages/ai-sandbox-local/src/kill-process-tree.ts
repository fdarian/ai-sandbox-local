import { type ChildProcess, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Every `run`/`spawn` child carries `AI_SANDBOX_LOCAL_SESSION_ID=<registry id>`
 * in its environment. Descendants inherit it, so it still identifies a
 * process after its parent died and it was reparented to PID 1.
 */
export const SESSION_ID_ENV = 'AI_SANDBOX_LOCAL_SESSION_ID';

interface ProcessSnapshot {
	childrenByParent: Map<number, number[]>;
	/** Empty unless the snapshot was asked to scan environments. */
	sessionPids: number[];
}

/**
 * SIGTERMs `child` and its current descendants; a descendant whose parent
 * already exited was reparented to PID 1 and can't be found this way. Killing
 * only the direct `/bin/bash -c` child leaves its descendants (e.g. a bridge
 * and the CLI server it launched) running, reparented to PID 1.
 *
 * Deliberately tree-only: it must not reach the rest of the session's
 * processes (see `killSessionProcesses`).
 */
export function killProcessTree(child: ChildProcess): void {
	const live = liveChildren([child]);
	if (live.length === 0) return;
	signalAndKill(live, readProcessSnapshot(undefined), []);
}

/**
 * Ends a whole session: the `children`'s descendants plus every process,
 * wherever it sits in the tree, whose environment carries `sessionId`'s
 * marker. The marker is what finds an orphan (e.g. the OpenCode adapter's
 * `opencode serve` after its bridge exited), which no ppid walk can.
 * Children are not made process-group leaders (`detached`) because that
 * would stop a terminal's Ctrl+C from reaching them.
 */
export function killSessionProcesses(
	children: Iterable<ChildProcess>,
	sessionId: string,
): void {
	// Unlike `killProcessTree`, no early return when nothing is live: the
	// orphans are exactly what's left after the tracked children are gone.
	const snapshot = readProcessSnapshot(sessionId);
	signalAndKill(liveChildren(children), snapshot, snapshot.sessionPids);
}

function liveChildren(children: Iterable<ChildProcess>): ChildProcess[] {
	return [...children].filter(
		(child) =>
			child.pid !== undefined &&
			child.exitCode === null &&
			child.signalCode === null,
	);
}

function signalAndKill(
	live: ChildProcess[],
	snapshot: ProcessSnapshot,
	extraPids: number[],
): void {
	const pids = new Set([
		...live.flatMap((child) =>
			collectDescendants(snapshot.childrenByParent, child.pid as number),
		),
		...extraPids,
	]);
	pids.delete(process.pid);

	for (const pid of pids) {
		signalIgnoringExited(pid);
	}
	for (const child of live) {
		child.kill('SIGTERM');
	}
}

/**
 * Must be taken before every signal: once a parent dies, its children move
 * to PID 1 and can no longer be traced back to it.
 *
 * Throws if `ps` fails: the alternative is silently leaving processes running.
 */
function readProcessSnapshot(sessionId: string | undefined): ProcessSnapshot {
	const marker =
		sessionId === undefined ? undefined : `${SESSION_ID_ENV}=${sessionId}`;
	// macOS prints the environment in the command column; Linux needs /proc.
	const environmentInPs = marker !== undefined && process.platform === 'darwin';
	const output = execFileSync(
		'ps',
		environmentInPs
			? ['-A', '-E', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'command=']
			: ['-A', '-o', 'pid=', '-o', 'ppid='],
		// A full environment dump of every process outgrows the 1 MiB default.
		{ encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024 },
	);

	const childrenByParent = new Map<number, number[]>();
	const entries: Array<{ pid: number; command: string }> = [];
	for (const line of output.split('\n')) {
		if (line.trim() === '') continue;
		const match = /^\s*(\d+)\s+(\d+)(?:\s+(.*))?$/.exec(line);
		if (match === null) {
			// An environment value containing a newline wraps `ps`'s output;
			// the remainder belongs to the previous process's command column.
			const previous = entries.at(-1);
			if (environmentInPs && previous !== undefined) {
				previous.command += ` ${line}`;
				continue;
			}
			throw new Error(`Unexpected 'ps' output line: ${JSON.stringify(line)}`);
		}
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const siblings = childrenByParent.get(ppid);
		if (siblings === undefined) {
			childrenByParent.set(ppid, [pid]);
		} else {
			siblings.push(pid);
		}
		entries.push({ pid, command: match[3] ?? '' });
	}

	const sessionPids: number[] = [];
	if (marker !== undefined) {
		for (const entry of entries) {
			const environment = environmentInPs
				? entry.command.split(/\s+/)
				: process.platform === 'linux'
					? readLinuxEnvironment(entry.pid)
					: [];
			if (environment.includes(marker)) sessionPids.push(entry.pid);
		}
	}
	return { childrenByParent, sessionPids };
}

function readLinuxEnvironment(pid: number): string[] {
	try {
		return readFileSync(`/proc/${pid}/environ`, 'utf-8').split('\0');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		// Exited since the `ps` snapshot, or owned by another user.
		if (code === 'ENOENT' || code === 'ESRCH' || code === 'EACCES') return [];
		throw error;
	}
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

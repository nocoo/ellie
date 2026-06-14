/**
 * Detached-spawn + tree-kill helpers for L3 runners.
 *
 * Why this exists:
 *   Both runners (forum + admin) start the Next.js dev server through a chain
 *   of bun script wrappers:
 *       bun run dev           → bun run dev:forum  → bun run --filter web dev   → next dev → next-server worker
 *       bun run dev:admin     → bun run --filter admin dev                     → next dev → next-server worker
 *   SIGTERM to the outer `bun` reaches the script wrapper but does NOT
 *   propagate to the `next-server` grandchild. The result is a leaked
 *   next-server that keeps port 27031 / 7032 bound, breaking the next runner
 *   invocation and accumulating orphan PIDs across sessions.
 *
 *   We side-step this by spawning the wrapper in a NEW process group
 *   (`detached: true` makes the child the group leader) and signaling the
 *   negative pid, which delivers the signal to every member of the group —
 *   including `next` and the `next-server` worker that next forks.
 *
 *   The same pattern applies to `wrangler dev`, which spawns a workerd
 *   grandchild; we use this helper for the Worker process too so the L3
 *   teardown story is uniform.
 *
 * Public surface:
 *   - spawnDetached(cmd, args, options) → ChildProcess
 *       Spawns with `detached: true`, so the child becomes a process group
 *       leader. Caller MUST eventually call killTree() to avoid leaking the
 *       whole group.
 *   - killTree(child, label, { timeoutMs }) → Promise<void>
 *       Sends SIGTERM to the group; if anything is still alive after
 *       `timeoutMs` (default 5s) escalates to SIGKILL. Idempotent — safe to
 *       call twice from finally + signal handler races.
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

export type DetachedSpawnOptions = {
	cwd: string;
	env: NodeJS.ProcessEnv;
};

export function spawnDetached(
	cmd: string,
	args: string[],
	options: DetachedSpawnOptions,
): ChildProcess {
	return nodeSpawn(cmd, args, {
		cwd: options.cwd,
		env: options.env,
		stdio: "inherit",
		// detached: true makes the child a new process group leader on POSIX,
		// so process.kill(-pid, sig) reaches every descendant the child
		// spawned (npm/bun script wrappers, the real `next`, and the
		// `next-server` worker that next forks).
		detached: true,
	});
}

function isAlive(pid: number): boolean {
	try {
		// Signal 0 is a permission/existence probe — no signal is delivered,
		// but ESRCH is thrown if the process is gone.
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Kill an entire process tree spawned via spawnDetached().
 *
 * Sends SIGTERM to the negative pid (whole group). Polls for up to
 * `timeoutMs` (default 5s); if anything is still alive, escalates to
 * SIGKILL on the group. Idempotent.
 */
export async function killTree(
	child: ChildProcess | null,
	label: string,
	options: { timeoutMs?: number } = {},
): Promise<void> {
	if (!child?.pid) return;
	const pid = child.pid;
	const timeoutMs = options.timeoutMs ?? 5_000;

	console.log(`🛑 Stopping ${label} (pgid=${pid})…`);

	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		// Group already gone (or never created in some exotic shell) — fall
		// through to the per-pid probe below; if the immediate child is also
		// dead, we are done.
	}

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return;
		await new Promise((r) => setTimeout(r, 100));
	}

	// Still alive — escalate. macOS / Linux both accept SIGKILL on the group.
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		// best effort
	}
	// Give the kernel a beat to reap before returning.
	await new Promise((r) => setTimeout(r, 200));
}

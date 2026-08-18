/**
 * Run Playwright while watching the local L3 Worker.
 *
 * When workerd dies mid-suite, Playwright keeps retrying auth/proxy fetches
 * against a dead :8788 for many minutes (ECONNREFUSED cascades). That burns
 * the GHA job budget and starves the intentional L3_ATTEMPTS retry loop.
 *
 * This helper serially polls worker health and tree-kills Playwright only after
 * consecutive failed probes, returning an explicit `worker-aborted` result so
 * the outer runner can classify a retryable worker-failure without re-probing.
 */

import type { ChildProcess } from "node:child_process";
import { killTree, spawnDetached } from "./process-tree";

export type GuardedPlaywrightResult =
	| { kind: "exit"; code: number }
	| { kind: "worker-aborted"; reason: string };

export type GuardedPlaywrightOptions = {
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	/** Return false when the Worker is dead or unresponsive. */
	isWorkerHealthy: () => boolean | Promise<boolean>;
	/** Delay between serial health probes (default 2s). */
	pollMs?: number;
	/** Consecutive failed probes required before abort (default 2). */
	consecutiveFailures?: number;
};

export type GuardedPlaywrightDeps = {
	spawnDetached: typeof spawnDetached;
	killTree: typeof killTree;
	delay: (ms: number) => Promise<void>;
};

const defaultDeps: GuardedPlaywrightDeps = {
	spawnDetached,
	killTree,
	delay: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export async function runPlaywrightGuarded(
	options: GuardedPlaywrightOptions,
	deps: GuardedPlaywrightDeps = defaultDeps,
): Promise<GuardedPlaywrightResult> {
	const pollMs = options.pollMs ?? 2_000;
	const consecutiveNeeded = options.consecutiveFailures ?? 2;

	const child: ChildProcess = deps.spawnDetached("bunx", ["playwright", "test", ...options.args], {
		cwd: options.cwd,
		env: options.env,
	});

	let exitCode: number | undefined;
	let exitError: Error | undefined;
	const exitPromise = new Promise<void>((resolve) => {
		child.once("error", (err) => {
			exitError = err;
			exitCode = 1;
			resolve();
		});
		child.once("exit", (code, signal) => {
			exitCode = code ?? (signal ? 1 : 0);
			resolve();
		});
	});

	let settled = false;
	const waitExitOr = async (ms: number): Promise<"exit" | "timeout"> => {
		if (settled) return "exit";
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timed = new Promise<"timeout">((resolve) => {
			timeoutId = setTimeout(() => resolve("timeout"), ms);
		});
		const exited = exitPromise.then(() => {
			settled = true;
			return "exit" as const;
		});
		const winner = await Promise.race([exited, timed]);
		if (timeoutId) clearTimeout(timeoutId);
		return winner;
	};

	let consecutiveFailures = 0;
	let abortedForWorker = false;
	let abortReason = "";

	while (true) {
		const winner = await waitExitOr(pollMs);
		if (winner === "exit") break;

		let healthy = false;
		try {
			healthy = await options.isWorkerHealthy();
		} catch {
			healthy = false;
		}

		if (healthy) {
			consecutiveFailures = 0;
			continue;
		}

		consecutiveFailures += 1;
		if (consecutiveFailures < consecutiveNeeded) {
			continue;
		}

		abortedForWorker = true;
		abortReason =
			"worker stopped responding to /api/live mid-run (guard confirmed consecutive probe failures)";
		console.error(
			`❌ L3 Worker unhealthy for ${consecutiveNeeded} consecutive probes — aborting Playwright to free retry budget`,
		);
		await deps.killTree(child, "Playwright (worker died)");
		// Wait for the process to actually exit after killTree.
		await exitPromise;
		break;
	}

	if (exitError) {
		console.error("playwright spawn error:", exitError);
	}

	if (abortedForWorker) {
		return { kind: "worker-aborted", reason: abortReason };
	}

	return { kind: "exit", code: exitCode ?? 1 };
}

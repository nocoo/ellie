/**
 * scripts/lib/local-worker — shared local wrangler worker lifecycle.
 *
 * Used by run-l2.ts / run-l3.ts / run-l3-admin.ts. Pulls TEST_WORKER_VARS
 * from scripts/lib/test-worker-vars.ts (the single data source — adding a
 * new test-only env var is a one-liner there that immediately covers
 * L2/L3/L3-admin).
 *
 * See docs/23-local-test-stack.md §2.5 (review v4 #1) for why
 * ENVIRONMENT:test and ALLOWED_ORIGINS:* are mandatory.
 */

import { type Subprocess, spawn } from "bun";
import { TEST_WORKER_VARS } from "./test-worker-vars";

export { TEST_WORKER_VARS };

export interface LocalWorkerOptions {
	/** Path (relative to repoRoot) of the wrangler --persist-to dir. */
	persistTo: string;
	/** Port for the wrangler dev server. */
	port: number;
	/** Repo root. Absolute. */
	repoRoot: string;
	/** Path to wrangler binary. Absolute. */
	wranglerBin: string;
	/** Path (relative to repoRoot) of the wrangler config. */
	wranglerConfig: string;
	/** Override or extend TEST_WORKER_VARS for this lifecycle. */
	extraVars?: Record<string, string>;
}

/**
 * Spawn `wrangler dev --local --persist-to <dir> --port <port>` with the
 * full TEST_WORKER_VARS clause. Returns the running Subprocess so the
 * caller can `await waitForWorker(...)` and later `.kill()` it.
 */
export function startLocalWorker(opts: LocalWorkerOptions): Subprocess {
	const vars = { ...TEST_WORKER_VARS, ...(opts.extraVars ?? {}) };
	const varFlags = Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]);

	console.log(`🚀 Starting Worker (wrangler dev --local) on port ${opts.port}…`);
	const proc = spawn({
		cmd: [
			opts.wranglerBin,
			"dev",
			"-c",
			opts.wranglerConfig,
			"--port",
			String(opts.port),
			"--local",
			"--persist-to",
			opts.persistTo,
			...varFlags,
		],
		cwd: opts.repoRoot,
		// "inherit" prevents wrangler from blocking on full stdout/stderr pipe
		// buffers during boot (the previous "pipe" config let the parent's
		// undrained pipes fill, which made wrangler block on writes and never
		// reach the ready state).
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...process.env,
			NODE_ENV: "test",
		},
	});

	return proc;
}

/**
 * Poll `<baseUrl>/api/live` until 200 (or proc exits). Throws on timeout
 * or if the worker process exits prematurely.
 */
export async function waitForWorker(
	baseUrl: string,
	proc: Subprocess,
	timeoutMs = 60_000,
	pollIntervalMs = 500,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (proc.exitCode != null) {
			throw new Error(`Worker exited prematurely with code ${proc.exitCode}`);
		}
		try {
			const res = await fetch(`${baseUrl}/api/live`);
			if (res.ok) {
				console.log(`✅ Worker ready at ${baseUrl}`);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, pollIntervalMs));
	}
	throw new Error(`Worker did not become ready within ${timeoutMs}ms at ${baseUrl}`);
}

export function stopLocalWorker(proc: Subprocess | null): void {
	if (!proc) return;
	console.log("🛑 Stopping Worker…");
	try {
		proc.kill();
	} catch {
		// ignore
	}
}

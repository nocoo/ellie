#!/usr/bin/env bun
/**
 * L2 Integration Test Runner
 *
 * Single-script orchestration of the L2 integration test loop:
 *   1. Clean previous local D1 / KV state under .wrangler/state/e2e
 *   2. Apply migrations to a fresh local D1 database
 *   3. Seed deterministic baseline rows from scripts/seed-test-db.sql
 *   4. Boot `wrangler dev` in --local mode with TEST_WORKER_VARS injected
 *      via --var (the var set is shared with L3 / L3-admin via
 *      scripts/lib/local-worker.ts so ENVIRONMENT:test / ALLOWED_ORIGINS:*
 *      are guaranteed present everywhere — fixing the historical bug where
 *      L2 fell back to prod \[vars\] and ran with ENVIRONMENT=production)
 *   5. Poll http://localhost:<port>/api/live until 200 (max 60s)
 *   6. Run the integration tests with the standard Bun test runner
 *   7. Tear down the Worker and exit with the test exit code
 *
 * Usage:
 *   bun run scripts/run-l2.ts
 *   bun run test:e2e:api
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "bun";
import { initLocalD1, type Subprocess } from "./lib/local-d1";
import { startLocalWorker, stopLocalWorker, waitForWorker } from "./lib/local-worker";

// ─── Configuration ─────────────────────────────────────────────

const TEST_PORT = 8787;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WORKER_READY_TIMEOUT_MS = 60_000;
const DB_INIT_TIMEOUT_MS = 60_000;

// Resolve repo root from this file's location so the script works regardless
// of the caller's cwd.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const PERSIST_TO = ".wrangler/state/e2e";
const WRANGLER_CONFIG = "apps/worker/wrangler.toml";
const SEED_FILE = "scripts/seed-test-db.sql";
const WRANGLER_BIN = resolve(REPO_ROOT, "apps/worker/node_modules/.bin/wrangler");

let workerProcess: Subprocess | null = null;

// ─── Steps ─────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
	workerProcess = startLocalWorker({
		persistTo: PERSIST_TO,
		port: TEST_PORT,
		repoRoot: REPO_ROOT,
		wranglerBin: WRANGLER_BIN,
		wranglerConfig: WRANGLER_CONFIG,
	});
	await waitForWorker(BASE_URL, workerProcess, WORKER_READY_TIMEOUT_MS);
}

function stopWorker(): void {
	stopLocalWorker(workerProcess);
	workerProcess = null;
}

async function runTests(): Promise<number> {
	console.log("🧪 Running integration tests…");
	// Run http/ + proxy/ explicitly; fast/ runs under `bun run test:l2:fast`
	// (in-process Worker, doesn't need wrangler) and is excluded here to
	// keep this lifecycle focused on the wrangler-dev path.
	const tests = spawn({
		cmd: [
			"bun",
			"test",
			"tests/integration/http/",
			"tests/integration/proxy/",
			"--timeout",
			"30000",
		],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
		env: {
			...process.env,
			// Mirror TEST_WORKER_VARS into the test env so workerFetch/setup.ts
			// helpers sign requests with the same secrets the worker accepts.
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			JWT_SECRET: "test-secret-key-for-jwt-hs256",
		},
	});

	const code = await tests.exited;
	return typeof code === "number" ? code : 1;
}

// ─── Main ──────────────────────────────────────────────────────

type RunOutcome =
	| { kind: "success" }
	| { kind: "setup-failure"; reason: string }
	| { kind: "worker-failure"; reason: string }
	| { kind: "test-failure"; exitCode: number };

async function runOnce(attempt: number, totalAttempts: number): Promise<RunOutcome> {
	console.log(`▶ L2 attempt ${attempt}/${totalAttempts}`);
	// Setup steps (cleanup / migrate / seed) must not be retried — failures
	// there indicate a real problem with the migrations or seed data, not a
	// transient workerd flake.
	try {
		await initLocalD1({
			persistTo: PERSIST_TO,
			repoRoot: REPO_ROOT,
			wranglerBin: WRANGLER_BIN,
			wranglerConfig: WRANGLER_CONFIG,
			seedFile: SEED_FILE,
			timeoutMs: DB_INIT_TIMEOUT_MS,
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return { kind: "setup-failure", reason };
	}

	// Worker startup is retried: startup timeout or premature exit is the
	// observable form of the wrangler/workerd transient crash.
	try {
		await startWorker();
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return { kind: "worker-failure", reason };
	}

	const exitCode = await runTests();
	if (exitCode === 0) return { kind: "success" };

	// Distinguish a real assertion regression from a workerd mid-run crash:
	// if the worker is no longer responding by the time the tests exit non-
	// zero, the failures are likely cascading ECONNRESET/ConnectionRefused
	// from a workerd crash (the wrangler parent process may still be alive
	// while the inner userWorker is dead, so exitCode alone is not enough).
	if (workerProcess?.exitCode != null) {
		return {
			kind: "worker-failure",
			reason: `worker died during tests (exit code ${workerProcess.exitCode})`,
		};
	}
	if (!(await isWorkerAlive())) {
		return {
			kind: "worker-failure",
			reason: "worker stopped responding to /api/live mid-run",
		};
	}
	return { kind: "test-failure", exitCode };
}

async function isWorkerAlive(): Promise<boolean> {
	try {
		const res = await fetch(`${BASE_URL}/api/live`);
		return res.ok;
	} catch {
		return false;
	}
}

function parseAttempts(): number {
	const raw = process.env.L2_ATTEMPTS;
	if (!raw) return 3;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) {
		console.warn(`⚠️  L2_ATTEMPTS="${raw}" is not a positive integer, falling back to 3`);
		return 3;
	}
	return n;
}

async function main(): Promise<void> {
	const totalAttempts = parseAttempts();
	let exitCode = 1;
	let lastFailure = "L2 runner failed";

	for (let attempt = 1; attempt <= totalAttempts; attempt++) {
		let outcome: RunOutcome;
		try {
			outcome = await runOnce(attempt, totalAttempts);
		} catch (err) {
			outcome = {
				kind: "worker-failure",
				reason: err instanceof Error ? err.message : String(err),
			};
		} finally {
			stopWorker();
		}

		if (outcome.kind === "success") {
			exitCode = 0;
			break;
		}
		if (outcome.kind === "setup-failure") {
			// Migration / seed errors are real; retrying would just mask them.
			console.error(`❌ Setup failed — not retrying: ${outcome.reason}`);
			exitCode = 1;
			lastFailure = `setup failure: ${outcome.reason}`;
			break;
		}
		if (outcome.kind === "test-failure") {
			// Real test regression — don't mask it with retries.
			console.error(
				`❌ Tests failed (exit ${outcome.exitCode}) with worker still alive — not retrying`,
			);
			exitCode = outcome.exitCode;
			lastFailure = `tests exited with code ${outcome.exitCode}`;
			break;
		}
		// worker-failure → retry if attempts remain
		console.warn(`⚠️  L2 attempt ${attempt}/${totalAttempts} worker failure: ${outcome.reason}`);
		lastFailure = outcome.reason;
		exitCode = 1;
		if (attempt < totalAttempts) {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}

	if (exitCode !== 0) {
		console.error(`❌ L2 runner failed after ${totalAttempts} attempt(s): ${lastFailure}`);
	}
	process.exit(exitCode);
}

// Best-effort cleanup on signals so a Ctrl-C doesn't leave a stray Worker.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		stopWorker();
		process.exit(130);
	});
}

main();

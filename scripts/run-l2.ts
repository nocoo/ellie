#!/usr/bin/env bun
/**
 * L2 Integration Test Runner
 *
 * Single-script orchestration of the L2 integration test loop:
 *   1. Clean previous local D1 / KV state under .wrangler/state/e2e
 *   2. Apply migrations to a fresh local D1 database
 *   3. Seed deterministic baseline rows from scripts/seed-test-db.sql
 *   4. Boot `wrangler dev` in --local mode with secrets injected via --var
 *   5. Poll http://localhost:8787/api/live until 200 (max 60s)
 *   6. Run the integration tests with the standard Bun test runner
 *   7. Tear down the Worker and exit with the test exit code
 *
 * This replaces the previous 3-layer setup (prepare-l2-local-db.sh + preload.ts +
 * setup.ts startWorker()) which was fragile in CI (npx vs bunx, mismatched
 * --persist-to paths, .dev.vars dependency).
 *
 * Usage:
 *   bun run scripts/run-l2.ts
 *   bun run test:e2e:api
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Subprocess, spawn } from "bun";

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
const PERSIST_ABS = resolve(REPO_ROOT, PERSIST_TO);
const WRANGLER_CONFIG = "apps/worker/wrangler.toml";
const SEED_FILE = "scripts/seed-test-db.sql";
const WRANGLER_BIN = resolve(REPO_ROOT, "apps/worker/node_modules/.bin/wrangler");

// Test-only secrets injected directly into the local Worker via --var. These
// match the defaults used by tests/integration/setup.ts, so no .dev.vars file
// is required (CI no longer needs that file).
const TEST_API_KEY = "test-api-key";
const TEST_ADMIN_API_KEY = "test-admin-api-key";
const TEST_JWT_SECRET = "test-secret-key-for-jwt-hs256";

let workerProcess: Subprocess | null = null;

// ─── Steps ─────────────────────────────────────────────────────

function cleanupTestState(): void {
	console.log("🧹 Cleaning previous L2 state…");
	if (existsSync(PERSIST_ABS)) {
		rmSync(PERSIST_ABS, { recursive: true, force: true });
		console.log(`   removed ${PERSIST_TO}`);
	} else {
		console.log("   no previous state");
	}
}

async function runWranglerOnce(args: string[], label: string, timeoutMs: number): Promise<void> {
	console.log(`▶ ${label}`);
	const proc = spawn({
		cmd: [WRANGLER_BIN, ...args],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			proc.kill();
			reject(new Error(`${label} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	try {
		const code = await Promise.race([proc.exited, timeout]);
		if (typeof code === "number" && code !== 0) {
			throw new Error(`${label} exited with code ${code}`);
		}
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function initDatabase(): Promise<void> {
	await runWranglerOnce(
		[
			"d1",
			"migrations",
			"apply",
			"DB",
			"--local",
			"--persist-to",
			PERSIST_TO,
			"-c",
			WRANGLER_CONFIG,
		],
		"Applying D1 migrations (local)",
		DB_INIT_TIMEOUT_MS,
	);
}

async function seedDatabase(): Promise<void> {
	if (!existsSync(resolve(REPO_ROOT, SEED_FILE))) {
		console.log(`⚠️  Seed file ${SEED_FILE} not found, skipping seed step`);
		return;
	}
	await runWranglerOnce(
		[
			"d1",
			"execute",
			"DB",
			"--local",
			"--persist-to",
			PERSIST_TO,
			"-c",
			WRANGLER_CONFIG,
			"--file",
			SEED_FILE,
		],
		"Seeding test data",
		DB_INIT_TIMEOUT_MS,
	);
}

async function startWorker(): Promise<void> {
	console.log("🚀 Starting Worker (wrangler dev --local)…");
	workerProcess = spawn({
		cmd: [
			WRANGLER_BIN,
			"dev",
			"-c",
			WRANGLER_CONFIG,
			"--port",
			String(TEST_PORT),
			"--local",
			"--persist-to",
			PERSIST_TO,
			"--var",
			`API_KEY:${TEST_API_KEY}`,
			"--var",
			`ADMIN_API_KEY:${TEST_ADMIN_API_KEY}`,
			"--var",
			`JWT_SECRET:${TEST_JWT_SECRET}`,
		],
		cwd: REPO_ROOT,
		// "inherit" prevents wrangler from blocking on full stdout/stderr pipe
		// buffers during boot. The previous "pipe" config let the parent's
		// undrained pipes fill, which made wrangler block on writes and never
		// reach the ready state — the pre-commit hook then hit a 60s timeout.
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...process.env,
			NODE_ENV: "test",
		},
	});

	await waitForWorker();
}

async function waitForWorker(): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < WORKER_READY_TIMEOUT_MS) {
		if (workerProcess?.exitCode != null) {
			throw new Error(`Worker exited prematurely with code ${workerProcess.exitCode}`);
		}
		try {
			const res = await fetch(`${BASE_URL}/api/live`);
			if (res.ok) {
				console.log(`✅ Worker ready on port ${TEST_PORT}`);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Worker did not become ready within ${WORKER_READY_TIMEOUT_MS}ms`);
}

function stopWorker(): void {
	if (!workerProcess) return;
	console.log("🛑 Stopping Worker…");
	try {
		workerProcess.kill();
	} catch {
		// ignore
	}
	workerProcess = null;
}

async function runTests(): Promise<number> {
	console.log("🧪 Running integration tests…");
	const tests = spawn({
		cmd: ["bun", "test", "tests/integration/", "--timeout", "30000"],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
		env: {
			...process.env,
			API_KEY: TEST_API_KEY,
			ADMIN_API_KEY: TEST_ADMIN_API_KEY,
			JWT_SECRET: TEST_JWT_SECRET,
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
		cleanupTestState();
		await initDatabase();
		await seedDatabase();
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

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
		cmd: ["bunx", "wrangler", ...args],
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
			"bunx",
			"wrangler",
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
		stdout: "pipe",
		stderr: "pipe",
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

async function main(): Promise<void> {
	let exitCode = 1;
	try {
		cleanupTestState();
		await initDatabase();
		await seedDatabase();
		await startWorker();
		exitCode = await runTests();
	} catch (err) {
		console.error("❌ L2 runner failed:", err instanceof Error ? err.message : err);
		exitCode = 1;
	} finally {
		stopWorker();
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

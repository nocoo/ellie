#!/usr/bin/env bun
/**
 * Shared local Worker lifecycle for L3 forum + admin runners.
 *
 * Boots an isolated `wrangler dev --local` Worker with a clean D1/KV/R2
 * persist directory, applies migrations, seeds the baseline rows, and yields
 * the URL/port + a teardown handle. Both runners route their Next.js dev
 * server's `WORKER_API_URL` at this local Worker so L3 runs with no
 * dependency on a deployed test Worker.
 *
 * Ref: docs/23-l3-bdd-refactor.md §Phase 0.2 (task #14)
 *
 * Why a shared module:
 *   - run-l3.ts and run-l3-admin.ts both need the same Worker; duplicating
 *     the lifecycle would drift the moment one side learns a new flag.
 *   - Forum + admin runners are called sequentially (`test:e2e:bdd` chains
 *     them), so a single Worker process per runner is enough — we cleanup
 *     the persist dir on each start to guarantee determinism.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Subprocess, spawn } from "bun";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/lib/l3-local-worker.ts → repo root is two levels up.
export const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

// L3 reserves a dedicated port + persist directory so it never collides with
// L2 (port 8787, .wrangler/state/e2e). Both runners share this single
// instance — they run sequentially, never in parallel against the same DB.
export const L3_WORKER_PORT = 8788;
export const L3_WORKER_URL = `http://localhost:${L3_WORKER_PORT}`;
const L3_PERSIST_TO = ".wrangler/state/l3";
const L3_PERSIST_ABS = resolve(REPO_ROOT, L3_PERSIST_TO);
const WRANGLER_CONFIG = "apps/worker/wrangler.toml";
const SEED_FILE = "scripts/seed-test-db.sql";
const WRANGLER_BIN = resolve(REPO_ROOT, "apps/worker/node_modules/.bin/wrangler");

const WORKER_READY_TIMEOUT_MS = 60_000;
const DB_INIT_TIMEOUT_MS = 60_000;

// Test-only secrets injected via wrangler --var. Match the values L2 uses
// (scripts/run-l2.ts) so the same fixtures and Worker code paths apply.
// Deliberately not loaded from any .env file: they are constants for the
// local Worker, must not leak into production deploys, and CI doesn't need
// any new secret for L3 to work locally.
export const L3_API_KEY = "test-api-key";
export const L3_ADMIN_API_KEY = "test-admin-api-key";
export const L3_JWT_SECRET = "test-secret-key-for-jwt-hs256";

export type LocalWorkerHandle = {
	url: string;
	stop: () => void;
};

function cleanupState(): void {
	console.log("🧹 Cleaning previous L3 worker state…");
	if (existsSync(L3_PERSIST_ABS)) {
		rmSync(L3_PERSIST_ABS, { recursive: true, force: true });
		console.log(`   removed ${L3_PERSIST_TO}`);
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

async function migrateDatabase(): Promise<void> {
	await runWranglerOnce(
		[
			"d1",
			"migrations",
			"apply",
			"DB",
			"--local",
			"--persist-to",
			L3_PERSIST_TO,
			"-c",
			WRANGLER_CONFIG,
		],
		"Applying D1 migrations (L3 local)",
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
			L3_PERSIST_TO,
			"-c",
			WRANGLER_CONFIG,
			"--file",
			SEED_FILE,
		],
		"Seeding L3 test data",
		DB_INIT_TIMEOUT_MS,
	);
}

async function waitForWorker(proc: Subprocess): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < WORKER_READY_TIMEOUT_MS) {
		if (proc.exitCode != null) {
			throw new Error(`L3 Worker exited prematurely with code ${proc.exitCode}`);
		}
		try {
			const res = await fetch(`${L3_WORKER_URL}/api/live`);
			if (res.ok) {
				console.log(`✅ L3 Worker ready on port ${L3_WORKER_PORT}`);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`L3 Worker did not become ready within ${WORKER_READY_TIMEOUT_MS}ms`);
}

/**
 * Start a clean local Worker for L3.
 *
 * Steps:
 *   1. Wipe `.wrangler/state/l3` so the run is deterministic.
 *   2. `wrangler d1 migrations apply DB --local --persist-to .wrangler/state/l3`.
 *   3. Seed `scripts/seed-test-db.sql` into the same local DB.
 *   4. Spawn `wrangler dev` on port 8788 with the test secrets injected via
 *      `--var`. Inheriting stdio prevents wrangler from blocking on a
 *      full pipe (the same pattern L2 uses).
 *   5. Poll `/api/live` until 200 (max 60s).
 *
 * Returns a handle whose `stop()` kills the Worker process. Callers MUST
 * invoke `stop()` in a `finally` so a failed Next/Playwright run never
 * leaks the Worker.
 */
export async function startLocalL3Worker(): Promise<LocalWorkerHandle> {
	cleanupState();
	await migrateDatabase();
	await seedDatabase();

	console.log(`🚀 Starting L3 Worker (wrangler dev --local) on port ${L3_WORKER_PORT}…`);
	const proc = spawn({
		cmd: [
			WRANGLER_BIN,
			"dev",
			"-c",
			WRANGLER_CONFIG,
			"--port",
			String(L3_WORKER_PORT),
			"--local",
			"--persist-to",
			L3_PERSIST_TO,
			"--var",
			`API_KEY:${L3_API_KEY}`,
			"--var",
			`ADMIN_API_KEY:${L3_ADMIN_API_KEY}`,
			"--var",
			`JWT_SECRET:${L3_JWT_SECRET}`,
		],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, NODE_ENV: "test" },
	});

	try {
		await waitForWorker(proc);
	} catch (err) {
		try {
			proc.kill();
		} catch {
			// ignore
		}
		throw err;
	}

	let stopped = false;
	return {
		url: L3_WORKER_URL,
		stop() {
			if (stopped) return;
			stopped = true;
			console.log("🛑 Stopping L3 Worker…");
			try {
				proc.kill();
			} catch {
				// ignore
			}
		},
	};
}

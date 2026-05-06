#!/usr/bin/env bun
/**
 * L3 Browser E2E Test Runner
 *
 * Single-script orchestration of the L3 Playwright loop:
 *   1. Load .env.local then .env.test (later wins)
 *   2. Validate D1 test isolation (Worker URL must point at a *-test worker)
 *   3. Boot Next.js dev server on port 27031 with the test env injected
 *   4. Poll http://localhost:27031 until 200 (max 90s)
 *   5. Run Playwright (test:e2e) and forward its exit code
 *   6. Tear down the dev server
 *
 * Mirrors the L2 pattern in scripts/run-l2.ts: lifecycle owned by this script,
 * not by playwright's webServer block, so CI gets deterministic teardown and
 * the env validation happens before any browser is launched.
 *
 * Usage:
 *   bun run scripts/run-l3.ts
 *   bun run test:e2e:browser
 *
 * Required env (typically supplied by .env.test in dev or CI secrets):
 *   WORKER_API_URL  — must contain "-test" (D1 isolation guard)
 *   FORUM_API_KEY   — a.k.a. API_KEY in CI; used by web→worker calls
 *   AUTH_SECRET     — NextAuth JWT signing key
 *   JWT_SECRET      — Worker JWT signing key (kept in sync for token verify)
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Subprocess, spawn } from "bun";

// ─── Configuration ─────────────────────────────────────────────

const TEST_PORT = 27031; // Browser E2E port (dev + 20000) — see docs/e2e-test-design.md
const BASE_URL = `http://localhost:${TEST_PORT}`;
const SERVER_READY_TIMEOUT_MS = 90_000;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

let serverProcess: Subprocess | null = null;

// ─── Env loading ───────────────────────────────────────────────

/**
 * Load KEY=value lines from a dotenv-style file into `process.env`.
 * Later files override earlier ones. Lines starting with `#` and blanks are
 * skipped; values may be wrapped in single or double quotes.
 *
 * We avoid `dotenv` to keep this script dependency-free — Next.js loads its
 * own env files for the dev server, but Playwright (the parent process)
 * needs the same vars in scope for any pre-flight checks.
 */
async function loadEnvFile(path: string): Promise<void> {
	if (!existsSync(path)) {
		console.log(`   skip (not found): ${path}`);
		return;
	}
	const text = await Bun.file(path).text();
	let count = 0;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
		count += 1;
	}
	console.log(`   loaded ${count} vars from ${path}`);
}

async function loadEnv(): Promise<void> {
	console.log("📦 Loading env files…");
	await loadEnvFile(resolve(REPO_ROOT, ".env.local"));
	await loadEnvFile(resolve(REPO_ROOT, ".env.test"));
}

// ─── D1 Isolation Guard ────────────────────────────────────────

/**
 * Refuse to launch unless the Worker URL clearly targets the *-test database.
 *
 * L3 talks to a deployed test Worker (CI secret WORKER_URL_TEST), not a local
 * `wrangler dev`. The test Worker is bound to `tongjinet-db-test` via
 * `[env.test]` in apps/worker/wrangler.toml. By gating on the URL substring
 * "-test" we ensure no L3 run can ever stomp on production D1.
 *
 * Mirrors the spirit of scripts/verify-test-db.ts — fail loudly, fail early.
 */
function validateAndOverride(): void {
	console.log("🔒 Validating D1 test isolation…");

	const workerUrl = process.env.WORKER_API_URL ?? "";
	if (!workerUrl) {
		throw new Error(
			"WORKER_API_URL is not set. L3 requires a deployed test Worker " +
				"(set WORKER_API_URL or supply WORKER_URL_TEST in CI).",
		);
	}
	if (!/-test(\.|\/|$)/.test(workerUrl) && !workerUrl.includes("ellie-test")) {
		throw new Error(
			`WORKER_API_URL=${workerUrl} does not look like a TEST worker. Refusing to run L3 against a non-test backend (D1 isolation).`,
		);
	}
	console.log(`   ✅ Worker URL points at test backend: ${workerUrl}`);

	for (const key of ["FORUM_API_KEY", "AUTH_SECRET", "JWT_SECRET"] as const) {
		if (!process.env[key]) {
			throw new Error(`Required env var ${key} is missing.`);
		}
	}
	console.log("   ✅ FORUM_API_KEY, AUTH_SECRET, JWT_SECRET present");
}

// ─── Server lifecycle ──────────────────────────────────────────

async function startServer(): Promise<void> {
	console.log(`🚀 Starting Next.js on port ${TEST_PORT}…`);
	serverProcess = spawn({
		cmd: ["bun", "run", "dev", "--port", String(TEST_PORT)],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...process.env,
			// NODE_ENV=test makes Next.js skip .env.local (which has CAPTCHA config
			// we don't want in E2E). Auth-related env vars are supplied via
			// apps/web/.env.test which Next.js loads when NODE_ENV=test.
			NODE_ENV: "test",
			// Belt-and-suspenders: also set directly in process.env in case
			// Next.js loads it before reading .env.test.
			NEXT_PUBLIC_CAP_API_ENDPOINT: "",
		},
	});
	await waitForServer();
}

async function waitForServer(): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < SERVER_READY_TIMEOUT_MS) {
		if (serverProcess?.exitCode != null) {
			throw new Error(`Dev server exited prematurely with code ${serverProcess.exitCode}`);
		}
		try {
			const res = await fetch(BASE_URL);
			if (res.ok || res.status === 404) {
				// 404 still means server is up and routing — good enough for readiness.
				console.log(`✅ Dev server ready at ${BASE_URL} (status ${res.status})`);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Dev server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}

function stopServer(): void {
	if (!serverProcess) return;
	console.log("🛑 Stopping dev server…");
	try {
		serverProcess.kill();
	} catch {
		// ignore
	}
	serverProcess = null;
}

// ─── Playwright ────────────────────────────────────────────────

async function runPlaywright(): Promise<number> {
	console.log("🎭 Running Playwright…");
	const proc = spawn({
		cmd: [
			"bunx",
			"playwright",
			"test",
			"-c",
			"playwright.config.ts",
			// Forum L3 only boots apps/web on 27031. The admin project lives
			// in its own runner (scripts/run-l3-admin.ts) and is excluded here
			// so a stray admin spec can't be sent against the forum dev server.
			"--project=stateless",
			"--project=stateful",
		],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
		env: process.env,
	});
	const code = await proc.exited;
	return typeof code === "number" ? code : 1;
}

// ─── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
	let exitCode = 1;
	try {
		await loadEnv();
		validateAndOverride();
		await startServer();
		exitCode = await runPlaywright();
	} catch (err) {
		console.error("❌ L3 runner failed:", err instanceof Error ? err.message : err);
		exitCode = 1;
	} finally {
		stopServer();
	}
	process.exit(exitCode);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		stopServer();
		process.exit(130);
	});
}

main();

#!/usr/bin/env bun
/**
 * L3 Browser E2E Test Runner — Forum app
 *
 * Single-script orchestration of the L3 Playwright loop:
 *   1. Start a clean local Worker via `wrangler dev --local` (see
 *      scripts/lib/l3-local-worker.ts). Migrate + seed a fresh local D1.
 *   2. Boot Next.js (apps/web) on port 27031 with WORKER_API_URL pointed
 *      at the local Worker on port 8788, and matching test secrets.
 *   3. Poll http://localhost:27031 until 200 (max 90s).
 *   4. Run Playwright (test:e2e) and forward its exit code.
 *   5. Tear down the dev server and the local Worker in reverse order.
 *
 * Lifecycle owned by this script — Playwright's `webServer` block is
 * deliberately unused so CI gets deterministic teardown and pre-flight env
 * validation happens before any browser is launched.
 *
 * Ref: docs/23-l3-bdd-refactor.md §Phase 0.2 (task #14). Removed the
 * remote-test-Worker dependency: L3 is now fully local — no
 * `WORKER_URL_TEST`, `JWT_SECRET`, or `FORUM_API_KEY` env required.
 *
 * Usage:
 *   bun run scripts/run-l3.ts
 *   bun run test:e2e:browser
 *   bun run scripts/run-l3.ts tests/e2e/bdd/navigation.spec.ts  # forwarded
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Subprocess, spawn } from "bun";
import {
	L3_API_KEY,
	L3_JWT_SECRET,
	L3_WORKER_URL,
	type LocalWorkerHandle,
	startLocalL3Worker,
} from "./lib/l3-local-worker";

const TEST_PORT = 27031; // Forum dev port — see docs/e2e-test-design.md
const BASE_URL = `http://localhost:${TEST_PORT}`;
const SERVER_READY_TIMEOUT_MS = 90_000;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

let serverProcess: Subprocess | null = null;
let workerHandle: LocalWorkerHandle | null = null;

// ─── Server lifecycle ──────────────────────────────────────────

async function startServer(): Promise<void> {
	console.log(`🚀 Starting Next.js (forum) on port ${TEST_PORT}…`);
	serverProcess = spawn({
		cmd: ["bun", "run", "dev", "--port", String(TEST_PORT)],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...process.env,
			NODE_ENV: "test",
			WORKER_API_URL: L3_WORKER_URL,
			FORUM_API_KEY: L3_API_KEY,
			// Both AUTH_SECRET (NextAuth) and JWT_SECRET (forwarded to anything
			// that still reads it directly) use the same constant as the local
			// Worker, so cross-process token verification stays consistent.
			AUTH_SECRET: L3_JWT_SECRET,
			JWT_SECRET: L3_JWT_SECRET,
			// CAPTCHA is fail-closed: an empty endpoint disables the form submit.
			// If the caller supplies NEXT_PUBLIC_CAP_API_ENDPOINT (CI does, via the
			// repo secret), forward it so the dev server renders a working widget
			// and the auth E2E tests can submit.
			NEXT_PUBLIC_CAP_API_ENDPOINT: process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "",
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

// ─── Route prewarm ─────────────────────────────────────────────

/**
 * Hit each heavy dynamic route once so Turbopack compiles it before
 * Playwright starts launching tests in parallel.
 *
 * Without this, the first test to navigate to `/forums/[id]` or
 * `/threads/[id]` can wait 20–30 s on Turbopack first-compile, which trips
 * Playwright's 30 s navigationTimeout and the 5 s expect timeout — cascading
 * into ~half the suite failing on cold runs.
 *
 * Each prewarm is fire-and-forget with a generous timeout; we don't fail the
 * runner if a route returns non-2xx (e.g. /me redirects to /login when
 * unauthenticated, which is fine — the compile still happened).
 */
async function prewarmRoutes(): Promise<void> {
	const routes = [
		"/",
		"/login",
		"/forums/1",
		"/forums/114",
		"/threads/1",
		"/users/100",
		"/me",
		"/search",
		"/digest",
		"/messages",
	];
	const started = Date.now();
	console.log("🔥 Prewarming routes…");
	for (const route of routes) {
		try {
			const res = await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(20_000) });
			console.log(`   ${route} → ${res.status}`);
		} catch (err) {
			console.log(`   ${route} → ${err instanceof Error ? err.message : err}`);
		}
	}
	console.log(`   prewarm done in ${Date.now() - started}ms`);
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
			// The `mobile` project covers the iPhone layout drift guard and
			// targets the same forum dev server, so it is included here.
			"--project=stateless",
			"--project=stateful",
			"--project=mobile",
			// Forward any extra CLI args (e.g. --reporter=json, file filters) that
			// were passed to run-l3.ts itself. Lets the autoresearch bench harness
			// (scripts/bench-l3.ts) ask for the JSON reporter without duplicating
			// server lifecycle code here.
			...process.argv.slice(2),
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
		workerHandle = await startLocalL3Worker();
		await startServer();
		await prewarmRoutes();
		exitCode = await runPlaywright();
	} catch (err) {
		console.error("❌ L3 runner failed:", err instanceof Error ? err.message : err);
		exitCode = 1;
	} finally {
		stopServer();
		workerHandle?.stop();
	}
	process.exit(exitCode);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		stopServer();
		workerHandle?.stop();
		process.exit(130);
	});
}

main();

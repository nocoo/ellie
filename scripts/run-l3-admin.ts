#!/usr/bin/env bun

/**
 * L3 Admin Browser E2E Test Runner
 *
 * Mirrors scripts/run-l3.ts but boots the Admin app on port 7032 and only
 * runs Playwright's `admin` project. Kept as a separate runner so the forum
 * L3 loop and the admin L3 loop can run independently — neither needs the
 * other's dev server up. Both reuse the shared local-Worker lifecycle
 * (scripts/lib/l3-local-worker.ts) so the Worker side stays in lockstep.
 *
 *   1. Start a clean local Worker via `wrangler dev --local` (shared helper).
 *   2. Boot `bun run dev:admin --port 7032` with NODE_ENV=test, WORKER_API_URL
 *      pointed at the local Worker, and admin-specific env (ADMIN_EMAILS +
 *      AUTH_SECRET) injected.
 *   3. Poll http://localhost:7032/login until 200 (max 90s).
 *   4. Run Playwright with `--project=admin` and forward the exit code.
 *   5. Tear down the dev server and the local Worker.
 *
 * Ref: docs/23-l3-bdd-refactor.md §Phase 0.2 (task #14). Removed the
 * remote-test-Worker dependency: L3 admin is now fully local — no
 * `WORKER_URL_TEST` env required.
 *
 * Admin-only env that still matters:
 *   ADMIN_EMAILS    — comma-separated whitelist. Defaults to the built-in
 *                     test admin email so a fresh checkout can run admin L3
 *                     without any .env edits; override via env to add more.
 *   E2E_ADMIN_EMAIL — optional override for the admin email the
 *                     loginAsAdmin fixture mints a session for.
 *   NEXT_PUBLIC_CAP_API_ENDPOINT — optional, forwarded if set.
 */

import { type ChildProcess, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	L3_ADMIN_API_KEY,
	L3_API_KEY,
	L3_JWT_SECRET,
	L3_WORKER_URL,
	type LocalWorkerHandle,
	startLocalL3Worker,
} from "./lib/l3-local-worker";
import { killTree, spawnDetached } from "./lib/process-tree";
import { readDotenvValue } from "./lib/read-dotenv";

// ─── Configuration ─────────────────────────────────────────────

const TEST_PORT = 7032; // Admin dev port — matches apps/admin/package.json scripts
const BASE_URL = `http://localhost:${TEST_PORT}`;
const READY_PATH = "/login"; // login page renders without a session
const SERVER_READY_TIMEOUT_MS = 90_000;
const TEST_ADMIN_EMAIL_DEFAULT = "e2e-admin@test.local";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
// Same rationale as scripts/run-l3.ts: skip the `bun run dev:admin → bun run
// --filter admin dev` wrapper chain and call apps/admin's next directly so
// killTree() can reach the next-server worker.
const NEXT_BIN = resolve(REPO_ROOT, "apps/admin/node_modules/.bin/next");

let serverProcess: ChildProcess | null = null;
let workerHandle: LocalWorkerHandle | null = null;

// ─── Env loading ───────────────────────────────────────────────

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
	console.log("📦 Loading admin env files (optional overrides)…");
	// Root + admin-scoped overrides. None are required — the runner supplies
	// safe defaults for ADMIN_EMAILS so a fresh checkout works; these files
	// just let teams override the whitelist or attach a Cap.js endpoint.
	await loadEnvFile(resolve(REPO_ROOT, ".env.local"));
	await loadEnvFile(resolve(REPO_ROOT, ".env.test"));
	await loadEnvFile(resolve(REPO_ROOT, "apps/admin/.env.local"));
	await loadEnvFile(resolve(REPO_ROOT, "apps/admin/.env.test"));
}

// ─── Pre-flight ────────────────────────────────────────────────

function resolveAdminEnv(): { email: string; whitelist: string } {
	const email = (process.env.E2E_ADMIN_EMAIL ?? TEST_ADMIN_EMAIL_DEFAULT).trim().toLowerCase();
	// If ADMIN_EMAILS is unset OR doesn't include the test admin, default to
	// the test admin so the admin gate lets loginAsAdmin through. This used
	// to require an explicit .env entry, which made fresh-checkout L3 fail
	// with a confusing redirect; safe defaults keep the runner self-contained.
	const declared = (process.env.ADMIN_EMAILS ?? "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	if (!declared.includes(email)) declared.push(email);
	const whitelist = declared.join(",");
	console.log(`   ✅ admin email "${email}" present in ADMIN_EMAILS whitelist`);
	return { email, whitelist };
}

// ─── Server lifecycle ──────────────────────────────────────────

async function startServer(adminEnv: { email: string; whitelist: string }): Promise<void> {
	console.log(`🚀 Starting Admin Next.js on port ${TEST_PORT}…`);
	// Symmetric with run-l3.ts: forward NEXT_PUBLIC_CAP_API_ENDPOINT from
	// apps/web/.env.local when not already in process env. Admin is
	// Google-only today, but the var is threaded through in case future
	// admin surfaces reuse the same Cap widget.
	const capEndpoint =
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ??
		readDotenvValue(resolve(REPO_ROOT, "apps/web/.env.local"), "NEXT_PUBLIC_CAP_API_ENDPOINT");
	serverProcess = spawnDetached(NEXT_BIN, ["dev", "--turbopack", "-p", String(TEST_PORT)], {
		cwd: resolve(REPO_ROOT, "apps/admin"),
		env: {
			...process.env,
			NODE_ENV: "test",
			WORKER_API_URL: L3_WORKER_URL,
			FORUM_API_KEY: L3_API_KEY,
			ADMIN_API_KEY: L3_ADMIN_API_KEY,
			AUTH_SECRET: L3_JWT_SECRET,
			JWT_SECRET: L3_JWT_SECRET,
			// Force Auth.js into HTTP mode. The developer .env.local carries an
			// https AUTH_URL (matching the real dev.hexly.ai reverse proxy),
			// which flips Auth.js to `useSecureCookies=true` and makes it look
			// for `__Secure-authjs.session-token`. The admin-base fixture in
			// tests/e2e/admin/fixtures/admin-base.ts injects the unprefixed
			// `authjs.session-token` (matches HTTP dev), so without this
			// override every admin API route returns 401 and 15+ specs fail.
			AUTH_URL: `${BASE_URL}`,
			ADMIN_EMAILS: adminEnv.whitelist,
			E2E_ADMIN_EMAIL: adminEnv.email,
			NEXT_PUBLIC_CAP_API_ENDPOINT: capEndpoint,
		},
	});
	await waitForServer();
}

async function waitForServer(): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < SERVER_READY_TIMEOUT_MS) {
		if (serverProcess?.exitCode != null) {
			throw new Error(`Admin dev server exited prematurely with code ${serverProcess.exitCode}`);
		}
		try {
			const res = await fetch(`${BASE_URL}${READY_PATH}`);
			if (res.ok || res.status === 404) {
				console.log(`✅ Admin dev server ready at ${BASE_URL} (status ${res.status})`);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`Admin dev server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
}

async function stopServer(): Promise<void> {
	if (!serverProcess) return;
	await killTree(serverProcess, "Next.js dev server (admin)");
	serverProcess = null;
}

// ─── Playwright ────────────────────────────────────────────────

async function runPlaywright(adminEnv: { email: string; whitelist: string }): Promise<number> {
	console.log("🎭 Running Playwright (admin project only)…");
	const result = spawnSync(
		"bunx",
		[
			"playwright",
			"test",
			"-c",
			"playwright.config.ts",
			"--project=admin",
			// Forward extra CLI args (file filters, --reporter=json, etc.) so
			// callers can target a single spec like the forum runner does.
			...process.argv.slice(2),
		],
		{
			cwd: REPO_ROOT,
			stdio: "inherit",
			// NODE_ENV must reach the Playwright worker process — the loginAsAdmin
			// fixture's hard guard checks it before minting a session cookie. The
			// AUTH_SECRET / ADMIN_EMAILS / E2E_ADMIN_EMAIL must also reach the
			// fixture so the cookie verifies against the same secret the server uses.
			env: {
				...process.env,
				NODE_ENV: "test",
				AUTH_SECRET: L3_JWT_SECRET,
				ADMIN_EMAILS: adminEnv.whitelist,
				E2E_ADMIN_EMAIL: adminEnv.email,
			},
		},
	);
	if (result.error) {
		console.error("playwright spawn error:", result.error);
		return 1;
	}
	return result.status ?? 1;
}

// ─── Main ──────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
	await stopServer();
	await workerHandle?.stop();
}

async function main(): Promise<void> {
	let exitCode = 1;
	try {
		await loadEnv();
		const adminEnv = resolveAdminEnv();
		workerHandle = await startLocalL3Worker();
		await startServer(adminEnv);
		exitCode = await runPlaywright(adminEnv);
	} catch (err) {
		console.error("❌ Admin L3 runner failed:", err instanceof Error ? err.message : err);
		exitCode = 1;
	} finally {
		await cleanup();
	}
	process.exit(exitCode);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		cleanup().finally(() => process.exit(130));
	});
}

main();

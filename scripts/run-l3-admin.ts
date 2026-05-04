#!/usr/bin/env bun
/**
 * L3 Admin Browser E2E Test Runner
 *
 * Mirrors scripts/run-l3.ts but boots the Admin app on port 7032 and only
 * runs Playwright's `admin` project. Kept as a separate runner so the forum
 * L3 loop and the admin L3 loop can run independently — neither needs the
 * other's dev server up.
 *
 *   1. Load .env.local → .env.test → apps/admin/.env.local → apps/admin/.env.test
 *      (later wins). Admin-scoped env files are loaded after the root files
 *      so the admin app can override shared vars (e.g. ADMIN_EMAILS).
 *   2. Validate D1 test isolation (Worker URL must point at a *-test worker)
 *      + presence of AUTH_SECRET / FORUM_API_KEY / ADMIN_EMAILS.
 *   3. Boot `bun run dev:admin --port 7032` with NODE_ENV=test.
 *   4. Poll http://localhost:7032/login until 200 (max 90s) — the login page
 *      renders without a session, so it's a stable readiness probe.
 *   5. Run Playwright with `--project=admin` and forward the exit code.
 *   6. Tear down the dev server.
 *
 * Required env (typically supplied by .env.test in dev or CI secrets):
 *   AUTH_SECRET     — NextAuth JWT signing key (must match what loginAsAdmin
 *                     fixture uses to mint the session cookie)
 *   ADMIN_EMAILS    — comma-separated whitelist; MUST include the fixture's
 *                     test admin email (default: e2e-admin@test.local)
 *   WORKER_API_URL  — must contain "-test" (D1 isolation guard); admin server
 *                     components hit Worker via this URL
 *   FORUM_API_KEY   — admin proxy uses this Key A to call Worker admin routes
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Subprocess, spawn } from "bun";

// ─── Configuration ─────────────────────────────────────────────

const TEST_PORT = 7032; // Admin dev port — matches apps/admin/package.json scripts
const BASE_URL = `http://localhost:${TEST_PORT}`;
const READY_PATH = "/login"; // login page renders without a session
const SERVER_READY_TIMEOUT_MS = 90_000;
const TEST_ADMIN_EMAIL_DEFAULT = "e2e-admin@test.local";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

let serverProcess: Subprocess | null = null;

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
	console.log("📦 Loading env files…");
	// Root-scoped first (shared with forum L3), then admin-scoped overrides.
	await loadEnvFile(resolve(REPO_ROOT, ".env.local"));
	await loadEnvFile(resolve(REPO_ROOT, ".env.test"));
	await loadEnvFile(resolve(REPO_ROOT, "apps/admin/.env.local"));
	await loadEnvFile(resolve(REPO_ROOT, "apps/admin/.env.test"));
}

// ─── Pre-flight validation ─────────────────────────────────────

function validateAndOverride(): void {
	console.log("🔒 Validating admin L3 pre-flight…");

	const workerUrl = process.env.WORKER_API_URL ?? "";
	if (!workerUrl) {
		throw new Error(
			"WORKER_API_URL is not set. Admin L3 requires a deployed test Worker " +
				"(set WORKER_API_URL or supply WORKER_URL_TEST in CI).",
		);
	}
	if (!/-test(\.|\/|$)/.test(workerUrl) && !workerUrl.includes("ellie-test")) {
		throw new Error(
			`WORKER_API_URL=${workerUrl} does not look like a TEST worker. Refusing to run L3 against a non-test backend (D1 isolation).`,
		);
	}
	console.log(`   ✅ Worker URL points at test backend: ${workerUrl}`);

	for (const key of ["AUTH_SECRET", "FORUM_API_KEY", "ADMIN_EMAILS"] as const) {
		if (!process.env[key]) {
			throw new Error(`Required env var ${key} is missing.`);
		}
	}
	console.log("   ✅ AUTH_SECRET, FORUM_API_KEY, ADMIN_EMAILS present");

	// The admin-auth smoke spec mints a session cookie for this email; if it's
	// not in the whitelist the gate will redirect and the spec will fail with
	// a confusing message instead of an explicit pre-flight error.
	const testAdminEmail = process.env.E2E_ADMIN_EMAIL ?? TEST_ADMIN_EMAIL_DEFAULT;
	const whitelist = new Set(
		(process.env.ADMIN_EMAILS ?? "")
			.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean),
	);
	if (!whitelist.has(testAdminEmail.toLowerCase())) {
		throw new Error(
			`ADMIN_EMAILS does not include the test admin email "${testAdminEmail}". Add it to .env.test (or apps/admin/.env.test) so the loginAsAdmin fixture can pass the admin gate.`,
		);
	}
	console.log(`   ✅ ADMIN_EMAILS contains test admin "${testAdminEmail}"`);
}

// ─── Server lifecycle ──────────────────────────────────────────

async function startServer(): Promise<void> {
	console.log(`🚀 Starting Admin Next.js on port ${TEST_PORT}…`);
	serverProcess = spawn({
		cmd: ["bun", "run", "dev:admin", "--", "--port", String(TEST_PORT)],
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: {
			...process.env,
			NODE_ENV: "test",
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

function stopServer(): void {
	if (!serverProcess) return;
	console.log("🛑 Stopping Admin dev server…");
	try {
		serverProcess.kill();
	} catch {
		// ignore
	}
	serverProcess = null;
}

// ─── Playwright ────────────────────────────────────────────────

async function runPlaywright(): Promise<number> {
	console.log("🎭 Running Playwright (admin project only)…");
	const proc = spawn({
		cmd: ["bunx", "playwright", "test", "-c", "playwright.config.ts", "--project=admin"],
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
		console.error("❌ Admin L3 runner failed:", err instanceof Error ? err.message : err);
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

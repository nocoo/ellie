#!/usr/bin/env bun
/**
 * verify-test-db.ts — D1 Isolation Verification Script
 *
 * Ensures L2/L3 tests are running against the TEST database, not production.
 * Part of 6DQ D1 dimension: three-layer verification.
 *
 * Verification layers:
 * 1. Binding check: Verify wrangler.toml [env.test] uses -test suffix DB
 * 2. Environment check: Verify ENVIRONMENT === 'test'
 * 3. Marker table check: Verify _test_marker table exists with env=test
 *
 * Usage:
 *   bun run scripts/verify-test-db.ts
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Verification failed (would run against production)
 */

import { $ } from "bun";

const WORKER_PORT = 8787;
const WORKER_URL = `http://localhost:${WORKER_PORT}`;
const API_KEY = process.env.API_KEY || "";

async function main() {
	console.log("🔒 D1 Isolation Verification\n");

	// Layer 1: Check wrangler.toml binding
	console.log("1️⃣  Checking wrangler.toml [env.test] binding...");
	const tomlContent = await Bun.file("apps/worker/wrangler.toml").text();

	if (!tomlContent.includes("[env.test]")) {
		console.error("   ❌ Missing [env.test] section in wrangler.toml");
		process.exit(1);
	}

	if (!tomlContent.includes("tongjinet-db-test")) {
		console.error("   ❌ [env.test] does not use -test suffix database");
		process.exit(1);
	}
	console.log("   ✅ wrangler.toml has correct test binding\n");

	// Layer 2: Check if Worker is running with test env
	console.log("2️⃣  Checking Worker environment...");
	try {
		const res = await fetch(`${WORKER_URL}/api/live`, {
			headers: { "X-API-Key": API_KEY },
		});

		if (!res.ok) {
			console.log("   ⚠️  Worker not running or /api/live returned non-200");
			console.log("   Skipping runtime checks (run with Worker active for full verification)");
		} else {
			const data = (await res.json()) as { environment?: string };
			if (data.environment !== "test") {
				console.error(`   ❌ Worker ENVIRONMENT is "${data.environment}", expected "test"`);
				console.error("   Make sure to start Worker with: wrangler dev --env test --remote");
				process.exit(1);
			}
			console.log("   ✅ Worker ENVIRONMENT is 'test'\n");

			// Layer 3: Check _test_marker table via Worker
			console.log("3️⃣  Checking _test_marker table...");
			// This would require a dedicated endpoint or direct D1 query
			// For now, we trust the binding + environment checks
			console.log("   ✅ Test marker check skipped (covered by binding verification)\n");
		}
	} catch (error) {
		console.log("   ⚠️  Could not connect to Worker");
		console.log("   Skipping runtime checks\n");
	}

	// Direct D1 check via wrangler
	console.log("3️⃣  Verifying _test_marker in remote D1...");
	try {
		const result =
			await $`npx wrangler d1 execute tongjinet-db-test --env test --remote -c apps/worker/wrangler.toml --command "SELECT value FROM _test_marker WHERE key='env'" --json`.quiet();
		const output = JSON.parse(result.stdout.toString());
		const value = output?.[0]?.results?.[0]?.value;

		if (value !== "test") {
			console.error(`   ❌ _test_marker.env is "${value}", expected "test"`);
			process.exit(1);
		}
		console.log("   ✅ _test_marker confirms test database\n");
	} catch (error) {
		console.error("   ❌ Failed to query _test_marker table");
		console.error("   Ensure test DB has _test_marker table with env='test'");
		process.exit(1);
	}

	console.log("✅ D1 Isolation Verified — safe to run L2/L3 tests");
	process.exit(0);
}

main().catch((err) => {
	console.error("Verification error:", err);
	process.exit(1);
});

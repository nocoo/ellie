// playwright.config.ts — E2E test configuration
// Ref: docs/e2e-test-design.md §Port Convention, §Test Isolation Strategy

import { defineConfig, devices } from "@playwright/test";

const PORT = 27031; // BDD E2E port (dev + 20000)
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "tests/e2e",
	forbidOnly: !!process.env.CI,
	// Local was 0 retries; CI uses 2. The autoresearch full-suite bench mirrors
	// CI behaviour and is acutely sensitive to single-test flakes: stateful
	// tests depend on `stateless` passing in full, so one flake costs ~10
	// reported failures. 1 retry is enough to absorb the occasional
	// per-test jitter without disguising deterministic regressions.
	retries: process.env.CI ? 2 : 1,
	// Force single worker to ensure stateful tests (thread/post) never run concurrently
	// This prevents cross-file race conditions when creating threads/posts
	workers: 1,
	reporter: "html",

	expect: {
		// Match CI's 15s expect.timeout in local runs too. The prior 5s value
		// was a fast-feedback default for individual devs running a single spec,
		// but the autoresearch loop (and `bun run test:e2e:browser`) executes the
		// full suite against a Turbopack dev server, where the first paint after
		// a route compile can legitimately take 6–12s. With 5s we flake on every
		// full run; with 15s the suite is stable and we still surface real
		// product regressions because the *navigation* timeout (30s) is what
		// catches genuine hangs.
		timeout: 15_000,
	},

	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
		locale: "zh-CN",
		timezoneId: "Asia/Shanghai",
		navigationTimeout: 30_000,
	},

	// ---------------------------------------------------------------------------
	// Projects: stateless (parallel within file) vs stateful (sequential)
	//           vs admin (separate dev server on 7032, own runner)
	// ---------------------------------------------------------------------------
	projects: [
		{
			name: "stateless",
			testMatch:
				/\/(navigation|navigation-extra|auth|search|system|redirect|pagination|message|user-journey|search-interaction|digest-filter|dialog-layout|not-found|user-actions)\.spec\.ts/,
			fullyParallel: true, // Tests within same file can run in parallel
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "stateful",
			testMatch: /\/(thread|post|post-comments|thread-crud|post-crud)\.spec\.ts/,
			fullyParallel: false,
			dependencies: ["stateless"], // Run after stateless completes
			use: { ...devices["Desktop Chrome"] },
		},
		{
			// Admin specs live under tests/e2e/admin/ and target apps/admin on
			// port 7032. They are run only by scripts/run-l3-admin.ts; the
			// forum runner explicitly passes --project=stateless --project=stateful
			// so this project never executes against the forum dev server.
			name: "admin",
			testDir: "tests/e2e/admin",
			testMatch: /.*\.spec\.ts/,
			fullyParallel: false,
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:7032" },
		},
	],

	// Server lifecycle is managed by scripts/run-l3.ts (loads .env files,
	// validates D1 isolation, starts dev server with test env, runs Playwright,
	// tears down). Keeping it out of playwright.config.ts ensures CI gets
	// deterministic teardown and pre-flight env validation.
});

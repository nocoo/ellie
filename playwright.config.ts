// playwright.config.ts — E2E test configuration
// Ref: docs/e2e-test-design.md §Port Convention, §Test Isolation Strategy

import { defineConfig, devices } from "@playwright/test";

const PORT = 27031; // BDD E2E port (dev + 20000)
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "tests/e2e",
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// Force single worker to ensure stateful tests (thread/post) never run concurrently
	// This prevents cross-file race conditions when creating threads/posts
	workers: 1,
	reporter: "html",

	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
		locale: "zh-CN",
		timezoneId: "Asia/Shanghai",
	},

	// ---------------------------------------------------------------------------
	// Projects: stateless (parallel within file) vs stateful (sequential)
	// ---------------------------------------------------------------------------
	projects: [
		{
			name: "stateless",
			testMatch: /\/(navigation|auth|search|system|redirect|pagination|message)\.spec\.ts/,
			fullyParallel: true, // Tests within same file can run in parallel
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "stateful",
			testMatch: /\/(thread|post|post-comments)\.spec\.ts/,
			fullyParallel: false,
			dependencies: ["stateless"], // Run after stateless completes
			use: { ...devices["Desktop Chrome"] },
		},
	],

	// Server lifecycle is managed by scripts/run-l3.ts (loads .env files,
	// validates D1 isolation, starts dev server with test env, runs Playwright,
	// tears down). Keeping it out of playwright.config.ts ensures CI gets
	// deterministic teardown and pre-flight env validation.
});

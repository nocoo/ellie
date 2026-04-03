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
			testMatch: /\/(navigation|auth|search|system)\.spec\.ts/,
			fullyParallel: true, // Tests within same file can run in parallel
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "stateful",
			testMatch: /\/(thread|post)\.spec\.ts/,
			fullyParallel: false,
			dependencies: ["stateless"], // Run after stateless completes
			use: { ...devices["Desktop Chrome"] },
		},
	],

	webServer: {
		command: `AUTH_SECRET=e2e-test-secret-key-at-least-32-characters NEXT_PUBLIC_CAP_API_ENDPOINT= bun run dev --port ${PORT}`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});

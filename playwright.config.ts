// playwright.config.ts — E2E test configuration
// Ref: 04-application §4.9.1 — Playwright on port 23000

import { defineConfig, devices } from "@playwright/test";

const PORT = 23000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: `AUTH_SECRET=e2e-test-secret-key-at-least-32-characters bun run dev --port ${PORT}`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});

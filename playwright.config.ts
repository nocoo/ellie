import { defineConfig, devices } from "@playwright/test";

const PORT = 27031;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "tests/e2e",
	forbidOnly: !!process.env.CI,
	retries: 1,
	workers: 4,
	reporter: "html",
	timeout: 90_000,

	expect: {
		timeout: 15_000,
	},

	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
		locale: "zh-CN",
		timezoneId: "Asia/Shanghai",
		navigationTimeout: 30_000,
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});

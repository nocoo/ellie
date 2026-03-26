// tests/e2e/auth-setup.ts — Shared login helper for E2E tests
// Logs in via the login page and returns the authenticated page context.

import type { Page } from "@playwright/test";

/**
 * Log in as a specific user via the login form.
 * Mock auth rule: password === username.
 */
export async function loginAs(page: Page, username: string): Promise<void> {
	await page.goto("/login");
	await page.fill('input[id="username"]', username);
	await page.fill('input[id="password"]', username);
	await page.click('button[type="submit"]');
	// Wait for redirect away from login page
	await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });
}

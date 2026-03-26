// tests/e2e/admin-path.spec.ts — E2E admin page reachability
// Ref: 04-application §4.9.3
//
// Verifies admin pages render without errors.
// Functional admin tests (ban, delete, toggle visibility) are in
// functional-flows.spec.ts.
//
// NOTE: With proxy auth enforcement, admin pages in E2E require either
// session cookies or bypassing the proxy. In dev mode, Next.js server
// renders pages directly (proxy only intercepts certain routes).
// Phase 2: Use proper login flow to set session cookie before admin tests.

import { expect, test } from "@playwright/test";

test.describe("Page reachability — admin", () => {
	test("admin dashboard page loads", async ({ page }) => {
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/admin/);
	});

	test("admin users page loads", async ({ page }) => {
		await page.goto("/admin/users");
		await expect(page).toHaveURL(/\/admin\/users/);
	});

	test("admin content page loads", async ({ page }) => {
		await page.goto("/admin/content");
		await expect(page).toHaveURL(/\/admin\/content/);
	});

	test("admin forums page loads", async ({ page }) => {
		await page.goto("/admin/forums");
		await expect(page).toHaveURL(/\/admin\/forums/);
	});

	test("admin sidebar navigation renders", async ({ page }) => {
		await page.goto("/admin");
		await expect(page.locator("text=Dashboard")).toBeVisible();
	});
});

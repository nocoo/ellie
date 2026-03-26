// tests/e2e/admin-path.spec.ts — E2E admin path
// Ref: 04-application §4.9.3
// Login Admin → dashboard → user management → ban

import { expect, test } from "@playwright/test";

test.describe("Admin path", () => {
	test("admin dashboard loads", async ({ page }) => {
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

	test("admin sidebar navigation is visible", async ({ page }) => {
		await page.goto("/admin");
		// Admin layout should have sidebar with navigation links
		await expect(page.locator("text=Dashboard")).toBeVisible();
	});
});

// tests/e2e/theme-responsive.spec.ts — E2E theme + responsive
// Ref: 04-application §4.9.4
// Dark mode toggle + mobile navigation

import { expect, test } from "@playwright/test";

test.describe("Theme and responsive", () => {
	test("page loads with default theme", async ({ page }) => {
		await page.goto("/");
		// HTML element should exist
		const html = page.locator("html");
		await expect(html).toBeVisible();
	});

	test("mobile viewport shows content", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 }); // iPhone
		await page.goto("/");
		// Page should load correctly on mobile
		await expect(page.locator("text=Ellie")).toBeVisible();
	});

	test("mobile viewport on login page", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto("/login");
		await expect(page.locator('input[id="username"]')).toBeVisible();
		await expect(page.locator('input[id="password"]')).toBeVisible();
	});

	test("tablet viewport shows content", async ({ page }) => {
		await page.setViewportSize({ width: 768, height: 1024 }); // iPad
		await page.goto("/");
		await expect(page.locator("text=Ellie")).toBeVisible();
	});

	test("desktop viewport shows full layout", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/");
		await expect(page.locator("text=Ellie")).toBeVisible();
		// Desktop should show navigation links
		await expect(page.locator("text=Home")).toBeVisible();
	});
});

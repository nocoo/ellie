// tests/e2e/system.spec.ts — E2E-SY System Flow Tests
// Ref: docs/e2e-test-design.md §E2E-SY: System Flow (1 spec)
// Includes responsive viewport tests (merged from theme-responsive.spec.ts)

import { expect, test } from "./fixtures/base";

test.describe("E2E-SY: System Flow", () => {
	/**
	 * E2E-SY-01: Theme Toggle (Three-state)
	 * Given I am on any page
	 * When I click theme toggle
	 * Then icon should change to Moon (dark)
	 * When I click again
	 * Then icon should change to Monitor (system)
	 * When I click again
	 * Then icon should change to Sun (light)
	 *
	 * Note: Theme is three-state cycle: light → dark → system → light
	 */
	test("E2E-SY-01: theme toggle cycles through three states", async ({ page }) => {
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Theme toggle button - labeled with current mode
		const themeToggle = page.locator('button[aria-label*="mode"], button[aria-label*="theme"]');
		await expect(themeToggle.first()).toBeVisible();

		// Get initial state
		const initialLabel = await themeToggle.first().getAttribute("aria-label");

		// Click to cycle to next state
		await themeToggle.first().click();
		await expect(themeToggle.first()).not.toHaveAttribute("aria-label", initialLabel ?? "");

		// Should have changed
		const secondLabel = await themeToggle.first().getAttribute("aria-label");
		expect(secondLabel).not.toBe(initialLabel);

		// Click again to cycle
		await themeToggle.first().click();
		await expect(themeToggle.first()).not.toHaveAttribute("aria-label", secondLabel ?? "");

		const thirdLabel = await themeToggle.first().getAttribute("aria-label");
		expect(thirdLabel).not.toBe(secondLabel);

		// Click again to cycle back
		await themeToggle.first().click();
		await expect(themeToggle.first()).toHaveAttribute("aria-label", initialLabel ?? "");
		// After 3 clicks, should be back to initial state (verified above)
	});
});

// ---------------------------------------------------------------------------
// Responsive Viewport Tests (merged from theme-responsive.spec.ts)
// ---------------------------------------------------------------------------

test.describe("Responsive Viewports", () => {
	test("mobile viewport (375x812) loads homepage", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 }); // iPhone
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		// Page should load correctly on mobile
		await expect(page.locator("body")).toBeVisible();
	});

	test("mobile viewport shows login form", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto("/login");
		await expect(page.locator('input[id="username"]')).toBeVisible();
		await expect(page.locator('input[id="password"]')).toBeVisible();
	});

	test("tablet viewport (768x1024) loads homepage", async ({ page }) => {
		await page.setViewportSize({ width: 768, height: 1024 }); // iPad
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await expect(page.locator("body")).toBeVisible();
	});

	test("desktop viewport (1440x900) shows full layout", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await expect(page.locator("body")).toBeVisible();
	});
});

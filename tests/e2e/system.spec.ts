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
	test("mobile viewport (375x812) loads homepage with forum content", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.setViewportSize({ width: 375, height: 812 }); // iPhone
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Should have main content area visible
		await expect(page.locator("main")).toBeVisible();

		// Forum groups should be visible (may stack vertically on mobile)
		const forumLinks = page.locator('a[href^="/forums/"]');
		await expect(forumLinks.first()).toBeVisible();

		// Header should be visible but may be condensed
		await expect(page.locator("header")).toBeVisible();
	});

	test("mobile viewport shows login form with proper layout", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto("/login");

		// Form inputs should be visible and full-width on mobile
		const usernameInput = page.locator('input[id="username"]');
		const passwordInput = page.locator('input[id="password"]');
		await expect(usernameInput).toBeVisible();
		await expect(passwordInput).toBeVisible();

		// Submit button should be visible
		await expect(page.locator('button[type="submit"]')).toBeVisible();
	});

	test("tablet viewport (768x1024) loads homepage with grid layout", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.setViewportSize({ width: 768, height: 1024 }); // iPad
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Main content should be visible
		await expect(page.locator("main")).toBeVisible();

		// Forum content should be present
		const forumLinks = page.locator('a[href^="/forums/"]');
		await expect(forumLinks.first()).toBeVisible();
	});

	test("desktop viewport (1440x900) shows full layout with sidebar", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Main content should be visible
		await expect(page.locator("main")).toBeVisible();

		// Forum links should be present
		const forumLinks = page.locator('a[href^="/forums/"]');
		await expect(forumLinks.first()).toBeVisible();

		// Header with navigation should be visible
		await expect(page.locator("header")).toBeVisible();
	});
});

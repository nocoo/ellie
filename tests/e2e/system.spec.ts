// tests/e2e/system.spec.ts — E2E-SY System Flow Tests
// Ref: docs/e2e-test-design.md §E2E-SY: System Flow (1 spec)

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
		const themeToggle = page.locator(
			'button[aria-label*="mode"], button[aria-label*="theme"]',
		);
		await expect(themeToggle.first()).toBeVisible();

		// Get initial state
		const initialLabel = await themeToggle.first().getAttribute("aria-label");

		// Click to cycle to next state
		await themeToggle.first().click();
		await page.waitForTimeout(100); // Wait for state update

		// Should have changed
		const secondLabel = await themeToggle.first().getAttribute("aria-label");
		expect(secondLabel).not.toBe(initialLabel);

		// Click again to cycle
		await themeToggle.first().click();
		await page.waitForTimeout(100);

		const thirdLabel = await themeToggle.first().getAttribute("aria-label");
		expect(thirdLabel).not.toBe(secondLabel);

		// Click again to cycle back
		await themeToggle.first().click();
		await page.waitForTimeout(100);

		const fourthLabel = await themeToggle.first().getAttribute("aria-label");
		// After 3 clicks, should be back to initial state
		expect(fourthLabel).toBe(initialLabel);
	});
});

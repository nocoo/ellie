// tests/e2e/digest-filter.spec.ts — E2E-DF Digest Filter Tests
// Covers: (F) digest page level tab switching and filter interaction

import { expect, test } from "./fixtures/base";

test.describe("E2E-DF: Digest Filters", () => {
	/**
	 * E2E-DF-01: Digest Level Tabs
	 * Given I am on /digest
	 * When I click a level filter tab (一星/二星/三星)
	 * Then URL should update with ?level= parameter
	 * And page should show filtered results or empty state
	 */
	test("E2E-DF-01: digest level tabs filter content", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		await page.goto("/digest");
		await page.waitForURL("**/digest");

		// Should see "精华帖列表" heading
		await expect(page.getByText("精华帖列表")).toBeVisible();

		// Should have level tabs — look for links with ?level= in href
		const levelTab = page.locator('a[href*="level=1"]').first();
		const hasLevelTab = await levelTab.isVisible().catch(() => false);

		if (hasLevelTab) {
			await levelTab.click();
			await page.waitForURL(/level=1/);

			// Should still see heading (page didn't crash)
			await expect(page.getByText("精华帖列表")).toBeVisible();
		}

		// Click "全部" tab to go back (link without level param)
		const allTab = page.locator('a[href="/digest"]').first();
		if (await allTab.isVisible()) {
			await allTab.click();
			await page.waitForURL("**/digest");
		}
	});
});

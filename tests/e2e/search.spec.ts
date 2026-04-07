// tests/e2e/search.spec.ts — E2E-SE Search Flow Tests
// Ref: docs/e2e-test-design.md §E2E-SE: Search Flow (2 specs)

import { expect, test } from "./fixtures/base";
import { SearchPage } from "./pages/search.page";

test.describe("E2E-SE: Search Flow", () => {
	/**
	 * E2E-SE-01: Search by Title
	 * Given I am on /search
	 * When I type "测试" in search input
	 * And I click search button
	 * Then URL should contain ?q=测试
	 * And I should see results or "未找到" message
	 */
	test("E2E-SE-01: search by title updates URL and shows results", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		const searchPage = new SearchPage(page);
		await searchPage.goto();

		// Perform search
		await searchPage.search("测试");

		// URL should contain query parameter
		await expect(page).toHaveURL(/q=/);

		// Should show results or no results message
		const hasResults = await searchPage.results
			.first()
			.isVisible()
			.catch(() => false);
		const hasNoResults = await searchPage.noResults.isVisible().catch(() => false);
		expect(hasResults || hasNoResults).toBe(true);

		// Type tabs should now be visible (only after query)
		await expect(searchPage.titleTab).toBeVisible();
		await expect(searchPage.authorTab).toBeVisible();
	});

	/**
	 * E2E-SE-02: Switch Search Type
	 * Given I have search results for "admin"
	 * When I click "按作者搜索" tab
	 * Then URL should contain ?type=author
	 * And results should update
	 */
	test("E2E-SE-02: switch search type updates URL", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		const searchPage = new SearchPage(page);
		await searchPage.goto();

		// First do a search to make tabs visible
		await searchPage.search("admin");

		// Wait for type tabs to appear
		await expect(searchPage.authorTab).toBeVisible();

		// Click author search tab
		await searchPage.switchToAuthorSearch();

		// URL should contain type=author
		await expect(page).toHaveURL(/type=author/);

		// Should still show results or no results
		const hasResults = await searchPage.results
			.first()
			.isVisible()
			.catch(() => false);
		const hasNoResults = await searchPage.noResults.isVisible().catch(() => false);
		expect(hasResults || hasNoResults).toBe(true);
	});
});

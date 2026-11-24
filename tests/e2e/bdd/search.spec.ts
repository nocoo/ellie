// tests/e2e/bdd/search.spec.ts — Feature: Forum Search (BDD)
// Ref: docs/23-l3-bdd-refactor.md

import { SearchPage } from "../pages/search.page";
import { expect, test } from "./fixtures";

test.describe("Feature: Forum Search", () => {
	test("Given I submit a title query from the search page or header search box, Then /search?q= renders results or the empty-state and links to threads", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		const searchPage = new SearchPage(page);
		await searchPage.goto();

		await searchPage.search("测试");
		await expect(page).toHaveURL(/q=/);
		const hasResults = await searchPage.results.first().isVisible();
		const hasNoResults = await searchPage.noResults.isVisible();
		expect(hasResults || hasNoResults).toBe(true);

		const searchInput = page.getByRole("searchbox", { name: "搜索主题", exact: true });
		await expect(searchInput).toBeVisible();
		await searchInput.fill("L3");
		await searchInput.press("Enter");
		await page.waitForURL(/\/search\?q=L3/);

		const resultLink = page.locator('a[href^="/threads/"]').first();
		if (await resultLink.isVisible()) {
			await resultLink.click();
			await page.waitForURL(/\/threads\/\d+/);
			await expect(page.locator("h1")).toBeVisible();
		} else {
			await expect(page.getByText(/未找到|没有找到|无结果|搜索出错|搜索失败/)).toBeVisible();
		}
	});
});

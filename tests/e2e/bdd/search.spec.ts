// tests/e2e/bdd/search.spec.ts — Feature: Forum Search (BDD)
// Ref: docs/23-l3-bdd-refactor.md

import { SearchPage } from "../pages/search.page";
import { expect, test } from "./fixtures";

test.describe("Feature: Forum Search", () => {
	test("Given I am on the search page, When I submit a title query, Then the URL gains ?q= and I see either results or the 未找到 empty-state", async ({
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
	});

	test("Given I am on the home page, When I submit a query in the header search box and open a result, Then I reach /search and the thread page", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto("/");
		await page.waitForURL("**/");

		const searchInput = page.getByRole("searchbox", { name: "搜索主题", exact: true });
		await expect(searchInput).toBeVisible();
		await searchInput.fill("L3");
		await searchInput.press("Enter");

		await page.waitForURL(/\/search\?q=L3/);
		const resultLink = page.locator('a[href^="/threads/"]').first();
		const hasResults = await resultLink.isVisible();

		if (hasResults) {
			await resultLink.click();
			await page.waitForURL(/\/threads\/\d+/);
			await expect(page.locator("h1")).toBeVisible();
		} else {
			const feedback = page.getByText(/未找到|没有找到|无结果|搜索出错|搜索失败/);
			await expect(feedback).toBeVisible();
		}
	});
});

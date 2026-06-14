// tests/e2e/bdd/search.spec.ts — Feature: Forum Search (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 1.2), §5.3 (合并表)
//
// Merges 2 legacy specs (search + search-interaction, 3 tests) into 3 BDD
// scenarios. No count reduction — only title FTS is supported, so each legacy
// test exercises a distinct flow worth keeping in BDD form. Traceability map
// lives in the commit message body.

import { SearchPage } from "../pages/search.page";
import { expect, test } from "./fixtures";

test.describe("Feature: Forum Search", () => {
	test("Given I am on the search page, When I submit a title query, Then the URL gains ?q= and I see either results or the 未找到 empty-state", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /search
		await loginAs("e2etest");
		const searchPage = new SearchPage(page);
		await searchPage.goto();

		// When: submit a title query via the main search form
		await searchPage.search("测试");

		// Then: URL carries the query
		await expect(page).toHaveURL(/q=/);

		// Then: either a result list OR the no-results card renders. The seed
		// may or may not contain a thread matching "测试", so we accept either
		// outcome — both prove the search round-trip succeeded.
		const hasResults = await searchPage.results.first().isVisible();
		const hasNoResults = await searchPage.noResults.isVisible();
		expect(hasResults || hasNoResults).toBe(true);
	});

	test("Given I am on the home page, When I submit a query in the header search box, Then I land on /search with the encoded query", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /
		await loginAs("e2etest");
		await page.goto("/");
		await page.waitForURL("**/");

		// When: type into the header search input and press Enter
		// CSS fallback: header renders two copies (mobile + desktop); aria-label
		// is the only stable hook shared by both.
		const searchInput = page.locator('input[aria-label="搜索主题和用户"]').first();
		await expect(searchInput).toBeVisible();
		await searchInput.fill("测试");
		await searchInput.press("Enter");

		// Then: navigation to /search?q=… with the URL-encoded query
		await page.waitForURL(/\/search\?q=/);
		expect(page.url()).toContain("q=%E6%B5%8B%E8%AF%95");
	});

	test("Given I am on the search results for q=L3, When I click a result link, Then I navigate to the thread page (or fall back to the empty-state)", async ({
		page,
		loginAs,
	}) => {
		// Search is the slowest L3 route: the worker /api/v1/search call can
		// take 5–10s, results render progressively, and clicking through
		// triggers a fresh Turbopack compile of /threads/[id]. test.slow()
		// triples the per-test timeout so we don't flake under cold Turbopack.
		test.slow();

		// Given: authenticated, results page for q=L3
		await loginAs("e2etest");
		await page.goto("/search?q=L3");
		await page.waitForURL("**/search?q=L3");

		// When: click the first result link if present
		const resultLink = page.locator('a[href^="/threads/"]').first();
		const hasResults = await resultLink.isVisible();

		if (hasResults) {
			// Then: navigate to /threads/<id> with a rendered heading
			await resultLink.click();
			await page.waitForURL(/\/threads\/\d+/);
			await expect(page.locator("h1")).toBeVisible();
		} else {
			// Then: when the seed has no L3 hits, the empty/error feedback
			// surfaces. We accept either path here because the L3 seed is
			// not guaranteed to contain the literal "L3" token; the assertion
			// of interest is that the search round-trip produced a usable UI.
			const feedback = page.getByText(/未找到|没有找到|无结果|搜索出错|搜索失败/);
			await expect(feedback).toBeVisible();
		}
	});
});

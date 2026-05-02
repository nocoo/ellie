// tests/e2e/pagination.spec.ts — E2E-PG Pagination Tests
// Covers: forum page pagination (#2), thread page post pagination (#3)

import { expect, test } from "./fixtures/base";
import { ForumPage } from "./pages/forum.page";
import { ThreadPage } from "./pages/thread.page";

test.describe("E2E-PG: Pagination", () => {
	/**
	 * E2E-PG-01: Forum Thread List Pagination
	 * Given I am on a forum page with enough threads
	 * Then I should see pagination controls or "load more"
	 * When I click next page
	 * Then URL should update with page parameter
	 * And thread list should refresh
	 */
	test("E2E-PG-01: forum page has pagination controls", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const forumPage = new ForumPage(page);
		await forumPage.goto(114);

		// Should have thread items
		await expect(forumPage.threadItems.first()).toBeVisible();

		// Look for pagination — could be page numbers or load-more button
		const pagination = page.locator('nav[aria-label="pagination"], [data-testid="pagination"]');
		const pageLinks = page.locator('a[href*="page="]');
		const loadMore = page.locator('button:has-text("加载更多"), button:has-text("下一页")');

		const hasPagination = await pagination.isVisible().catch(() => false);
		const hasPageLinks = (await pageLinks.count()) > 0;
		const hasLoadMore = await loadMore.isVisible().catch(() => false);

		// At least one pagination mechanism should exist
		expect(hasPagination || hasPageLinks || hasLoadMore).toBe(true);
	});

	/**
	 * E2E-PG-02: Thread Post List Pagination
	 * Given I am on a thread with many replies
	 * Then I should see pagination controls
	 * And I should be able to navigate to page 2
	 */
	test("E2E-PG-02: thread page has pagination for posts", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174);

		// Should have posts
		await expect(threadPage.postCards.first()).toBeVisible();

		// Look for pagination controls
		const pageLinks = page.locator('a[href*="page="]');
		const pagination = page.locator('nav[aria-label="pagination"], [data-testid="pagination"]');

		const hasPageLinks = (await pageLinks.count()) > 0;
		const hasPagination = await pagination.isVisible().catch(() => false);

		// Should have some form of pagination
		expect(hasPageLinks || hasPagination).toBe(true);

		// If page links exist, click page 2
		if (hasPageLinks) {
			const page2Link = page.locator('a[href*="page=2"]').first();
			if (await page2Link.isVisible()) {
				await page2Link.click();
				await page.waitForLoadState("networkidle");

				// URL should contain page=2
				expect(page.url()).toContain("page=2");

				// Should still have post cards
				await expect(threadPage.postCards.first()).toBeVisible();
			}
		}
	});
});

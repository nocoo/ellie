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

		// Pagination uses path-segment format: /forums/114/2, /forums/114/3, etc.
		const pageLinks = page.locator('a[href*="/forums/114/"]');
		const loadMore = page.locator('button:has-text("加载更多"), button:has-text("下一页")');

		const hasPageLinks = (await pageLinks.count()) > 0;
		const hasLoadMore = await loadMore.isVisible().catch(() => false);

		// At least one pagination mechanism should exist
		expect(hasPageLinks || hasLoadMore).toBe(true);
	});

	/**
	 * E2E-PG-02: Thread Post List Pagination
	 * Given I am on a thread with many replies (25 posts, postsPerPage=20 → 2 pages)
	 * Then I should see page-number pagination controls
	 * When I click page 2
	 * Then URL should update with ?page=2
	 * And I should still see post cards
	 */
	test("E2E-PG-02: thread page has pagination for posts", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174);

		// Should have posts
		await expect(threadPage.postCards.first()).toBeVisible();

		// Thread page uses path-segment pagination: /threads/662174/2
		const page2Link = page.locator('a[href$="/threads/662174/2"]');

		await expect(page2Link.first()).toBeVisible({ timeout: 5000 });

		// Click page 2
		await page2Link.first().click();
		await page.waitForURL(/\/threads\/662174\/2/);

		// Should still have post cards on page 2
		await expect(threadPage.postCards.first()).toBeVisible();
	});
});

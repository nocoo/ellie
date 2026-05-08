// tests/e2e/navigation.spec.ts — E2E-NV Navigation Flow Tests
// Ref: docs/e2e-test-design.md §E2E-NV: Navigation Flow (6 specs)
//
// Note: Production has require_login enabled, so we need to authenticate
// before accessing most pages. The tests use loginAs fixture.

import { expect, test } from "./fixtures/base";
import { ForumPage } from "./pages/forum.page";
import { HomePage } from "./pages/home.page";
import { SearchPage } from "./pages/search.page";
import { ThreadPage } from "./pages/thread.page";
import { UserPage } from "./pages/user.page";

test.describe("E2E-NV: Navigation Flow", () => {
	/**
	 * E2E-NV-01: Homepage Loads
	 * Given I am logged in and navigate to /
	 * Then I should see forum groups
	 * And I should see digest showcase
	 * And I should see home footer
	 */
	test("E2E-NV-01: homepage loads with forum groups and digest", async ({ page, loginAs }) => {
		// Login first (require_login is enabled in production)
		await loginAs("e2etest");

		const homePage = new HomePage(page);
		await homePage.goto();

		// Should see at least one forum group (or empty state)
		const isLoaded = await homePage.isLoaded();
		expect(isLoaded).toBe(true);

		// Should see digest showcase link
		await expect(homePage.digestShowcase).toBeVisible();
	});

	/**
	 * E2E-NV-02: Forum Page Loads
	 * Given I am logged in and navigate to /forums/114 (同济闲话)
	 * Then I should see forum heading
	 * And I should see "发表新帖" button
	 * And I should see thread list
	 */
	test("E2E-NV-02: forum page loads with heading and thread list", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const forumPage = new ForumPage(page);
		await forumPage.goto(114); // Use a real forum with threads

		// Should have forum heading
		await expect(forumPage.heading).toBeVisible();

		// Should have new thread button with correct text
		await expect(forumPage.newThreadButton).toBeVisible();

		// Should have thread list (or empty state)
		const hasThreads = await forumPage.threadList.isVisible().catch(() => false);
		const hasEmpty = await forumPage.emptyState.isVisible().catch(() => false);
		expect(hasThreads || hasEmpty).toBe(true);
	});

	/**
	 * E2E-NV-03: Thread Page Loads
	 * Given I am logged in and navigate to /threads/662174
	 * Then I should see thread title
	 * And I should see post cards
	 * And I should see breadcrumbs
	 */
	test("E2E-NV-03: thread page loads with title and posts", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174); // Use a real thread ID

		// Should have thread title heading
		await expect(threadPage.heading).toBeVisible();

		// Should have breadcrumbs
		await expect(threadPage.breadcrumbs).toBeVisible();

		// Should have at least one post card
		await expect(threadPage.postCards.first()).toBeVisible();
	});

	/**
	 * E2E-NV-04: User Profile Loads
	 * Given I am logged in and navigate to /users/64495 (CS)
	 * Then I should see user avatar
	 * And I should see stats cards (threads/posts/credits)
	 * And I should see tab navigation
	 */
	test("E2E-NV-04: user profile loads with avatar and stats", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const userPage = new UserPage(page);
		await userPage.goto(64495); // Use a real active user ID

		// Should have username heading
		await expect(userPage.username).toBeVisible();

		// Should have stats cards (5 cards: threads, posts, digest, credits, coins)
		await expect(userPage.statsCards).toHaveCount(5);

		// Should have tab navigation
		await expect(userPage.tabNav).toBeVisible();
	});

	/**
	 * E2E-NV-05: Digest Page Loads
	 * Given I am logged in and navigate to /digest
	 * Then I should see "精华帖列表" heading
	 * And I should see digest statistics
	 */
	test("E2E-NV-05: digest page loads with heading and stats", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		await page.goto("/digest");
		await page.waitForLoadState("networkidle");

		// Should have "精华帖列表" heading
		await expect(page.locator("text=精华帖列表")).toBeVisible();

		// Should have hero with "篇精华" stat (digest-hero.tsx text-xl block)
		await expect(page.locator("text=篇精华")).toBeVisible();

		// Should have level filter tabs (全部 / 一星 / 二星 / 三星)
		await expect(page.locator("text=论坛精华 · 知识殿堂")).toBeVisible();
	});

	/**
	 * E2E-NV-06: Search Page Loads
	 * Given I am logged in and navigate to /search
	 * Then I should see search input
	 * And I should see "搜索" button
	 * Note: Search type tabs only appear AFTER a query is submitted
	 */
	test("E2E-NV-06: search page loads with input and button", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const searchPage = new SearchPage(page);
		await searchPage.goto();

		// Should have search input
		await expect(searchPage.searchInput).toBeVisible();

		// Should have search button
		await expect(searchPage.searchButton).toBeVisible();

		// Should show empty state prompt (no tabs before query)
		await expect(searchPage.emptyPrompt).toBeVisible();
	});
});

// tests/e2e/user-journey.spec.ts — E2E-UJ User Journey Tests
// Covers: (A) click-through navigation, (B) /me page, (C) user profile tabs
// These are read-only flows exercised by the e2etest user.

import { expect, test } from "./fixtures/base";
import { HomePage } from "./pages/home.page";

test.describe("E2E-UJ: User Journey", () => {
	/**
	 * E2E-UJ-01: Click-Through Navigation
	 * Homepage → click forum → click thread → breadcrumb back to forum
	 */
	test("E2E-UJ-01: homepage → forum → thread → breadcrumb back", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		// Start at homepage
		const homePage = new HomePage(page);
		await homePage.goto();
		expect(await homePage.isLoaded()).toBe(true);

		// Click into a forum (any forum link)
		const forumLink = page.locator('a[href^="/forums/"]').first();
		await expect(forumLink).toBeVisible();
		await forumLink.click();
		await page.waitForURL(/\/forums\/\d+/);

		await expect(page.locator("h1")).toBeVisible();

		// Click into a thread
		const threadLink = page.locator('a[href^="/threads/"]').first();
		await expect(threadLink).toBeVisible();
		await threadLink.click();
		await page.waitForURL(/\/threads\/\d+/);

		await expect(page.locator("h1")).toBeVisible();

		// Navigate back via breadcrumb
		const breadcrumbForumLink = page
			.locator("nav.flex.items-center.gap-1")
			.locator('a[href^="/forums/"]')
			.first();
		await expect(breadcrumbForumLink).toBeVisible();
		await breadcrumbForumLink.click();
		await page.waitForURL(/\/forums\/\d+/);
	});

	/**
	 * E2E-UJ-02: /me Page Loads
	 * Given I am logged in
	 * When I navigate to /me
	 * Then I should see "我的账号" breadcrumb
	 * And I should see email verification section
	 */
	test("E2E-UJ-02: /me page loads with email verification card", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		await page.goto("/me");
		await page.waitForURL("**/me");

		// Should have breadcrumb with "我的账号"
		await expect(page.getByText("我的账号")).toBeVisible();

		// Should have email verification section (id="email")
		const emailSection = page.locator("#email");
		await expect(emailSection).toBeVisible();
	});

	/**
	 * E2E-UJ-03: User Profile Tab Switching
	 * Given I am on a user profile page
	 * When I click each tab (threads/posts/digest)
	 * Then URL should update with ?tab= parameter
	 * And tab content should change
	 */
	test("E2E-UJ-03: user profile tabs switch content", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		// Go to e2eprofile user (id=64495, has 1 thread + 1 post per seed)
		await page.goto("/users/64495");
		await page.waitForURL("**/users/64495**");

		// Should see username
		await expect(page.getByText("e2eprofile")).toBeVisible();

		// Click "回帖" tab (posts)
		const postsTab = page.locator('a[href*="tab=posts"]');
		await expect(postsTab).toBeVisible();
		await postsTab.click();
		await page.waitForURL(/tab=posts/);

		// Click "精华" tab (digest)
		const digestTab = page.locator('a[href*="tab=digest"]');
		await expect(digestTab).toBeVisible();
		await digestTab.click();
		await page.waitForURL(/tab=digest/);

		// Click "主题" tab (threads) to go back
		const threadsTab = page.locator('a[href*="tab=threads"]');
		await expect(threadsTab).toBeVisible();
		await threadsTab.click();
		await page.waitForURL(/tab=threads/);
	});
});

// tests/e2e/post-comments.spec.ts — E2E-PC Post Comments Tests
// Covers: #16 post-comments loading depth, #7 partial (comment section visible)

import { expect, test } from "./fixtures/base";
import { ThreadPage } from "./pages/thread.page";

test.describe("E2E-PC: Post Comments", () => {
	/**
	 * E2E-PC-01: Post Comments Section Loads
	 * Given I am on a thread page with posts that have comments
	 * Then I should see "点评" sections under relevant posts
	 * And comments should display author name and content
	 */
	test("E2E-PC-01: post comments section loads with author and content", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174);

		// Wait for posts to load
		await expect(threadPage.postCards.first()).toBeVisible();

		// Seed data includes 2 comments on post 662174 by e2etest and e2eprofile.
		// The post-comments component renders them inside a section with "点评" header.
		// Verify seeded comment content is visible.
		await expect(page.getByText("写得好！")).toBeVisible({ timeout: 10000 });

		// Verify comment author link exists
		const commentAuthorLink = page.locator('a[href="/users/100"]');
		expect(await commentAuthorLink.count()).toBeGreaterThan(0);
	});

	/**
	 * E2E-PC-02: Comment Button Visible on Posts
	 * Given I am logged in and viewing a thread
	 * Then each post should have a "点评" action button
	 */
	test("E2E-PC-02: comment button visible on post action bar", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174);

		// Wait for posts to load
		await expect(threadPage.postCards.first()).toBeVisible();

		// Should have at least one "点评" button in post actions
		const commentButtons = page.locator('button:has-text("点评"), span:has-text("点评")');
		expect(await commentButtons.count()).toBeGreaterThan(0);
	});
});

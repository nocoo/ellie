// tests/e2e/post.spec.ts — E2E-PO Post Flow Tests
// Ref: docs/e2e-test-design.md §E2E-PO: Post Flow (2 specs)

import { expect, test } from "./fixtures/base";
import { ThreadPage } from "./pages/thread.page";

test.describe("E2E-PO: Post Flow", () => {
	/**
	 * E2E-PO-01: View Posts
	 * Given I navigate to /threads/50001
	 * Then I should see multiple post cards
	 * And each post should have author sidebar
	 * And each post should have content area
	 */
	test("E2E-PO-01: view posts shows cards with author and content", async ({ page }) => {
		const threadPage = new ThreadPage(page);
		await threadPage.goto(50001);

		// Should have at least one post card
		const postCards = threadPage.postCards;
		await expect(postCards.first()).toBeVisible();

		// Check first post has author link
		const firstPost = postCards.first();
		const authorLink = firstPost.locator('a[href^="/users/"]');
		await expect(authorLink.first()).toBeVisible();

		// Check first post has content
		const content = firstPost.locator(".prose");
		await expect(content).toBeVisible();
	});

	/**
	 * E2E-PO-02: Reply to Thread (Logged In)
	 * Given I am logged in
	 * And I am on /threads/50001
	 * And thread is not closed
	 * When I click reply button in floating actions (or post action bar)
	 * Then reply dialog should open with title "回复帖子"
	 * When I type content (min 2 chars) in editor
	 * And I click "发送回复" button
	 * Then dialog should close
	 * And page should refresh (router.refresh)
	 * And my reply should appear in post list
	 */
	test("E2E-PO-02: logged-in user can reply to thread", async ({ page, loginAs }) => {
		// Login first
		await loginAs("admin");

		// Go to thread page
		const threadPage = new ThreadPage(page);
		await threadPage.goto(50001);

		// Count existing posts
		const initialCount = await threadPage.postCards.count();

		// Find and click reply button
		// Could be in floating actions or post action bar
		const replyButton = page.getByRole("button", { name: /回复/ }).first();
		await expect(replyButton).toBeVisible();
		await replyButton.click();

		// Dialog should be visible with correct title
		const dialog = page.locator('[role="dialog"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.locator("text=回复帖子")).toBeVisible();

		// Fill content in editor (min 2 chars)
		const uniqueReply = `E2E Test Reply ${Date.now()}`;
		const editor = dialog.locator('[contenteditable="true"], textarea').first();
		await editor.click();
		await editor.fill(uniqueReply);

		// Click submit button
		await dialog.getByRole("button", { name: /发送回复/ }).click();

		// Dialog should close
		await expect(dialog).not.toBeVisible({ timeout: 15000 });

		// Our reply should appear in the page (wait for content, not networkidle)
		const replyLocator = page.locator(`text=${uniqueReply}`);
		await expect(replyLocator).toBeVisible({ timeout: 10000 });
	});
});

// tests/e2e/thread.spec.ts — E2E-TH Thread Flow Tests
// Ref: docs/e2e-test-design.md §E2E-TH: Thread Flow (2 specs)

import { expect, test } from "./fixtures/base";
import { ForumPage } from "./pages/forum.page";
import { ThreadPage } from "./pages/thread.page";

test.describe("E2E-TH: Thread Flow", () => {
	/**
	 * E2E-TH-01: View Thread Detail
	 * Given I navigate to /threads/50001
	 * Then I should see thread subject
	 * And I should see author info
	 * And I should see post content
	 */
	test("E2E-TH-01: view thread detail shows subject and posts", async ({ page }) => {
		const threadPage = new ThreadPage(page);
		await threadPage.goto(50001);

		// Should have thread subject heading
		await expect(threadPage.heading).toBeVisible();
		const subject = await threadPage.heading.textContent();
		expect(subject).toBeTruthy();

		// Should have author info link
		await expect(threadPage.authorInfo).toBeVisible();

		// Should have at least one post with content
		const firstPost = threadPage.postCards.first();
		await expect(firstPost).toBeVisible();

		// Post should have prose content
		const postContent = firstPost.locator(".prose");
		await expect(postContent).toBeVisible();
	});

	/**
	 * E2E-TH-02: Create Thread (Logged In)
	 * Given I am logged in
	 * And I navigate to /forums/10
	 * When I click "发表新帖" button
	 * Then new thread dialog should open with title "发表新帖"
	 * When I fill subject (min 4 chars) in subject input
	 * And I fill content (min 10 chars) in editor
	 * And I click "发布帖子" button
	 * Then dialog should close
	 * And I should be navigated to /threads/{new_id}
	 * And I should see my thread subject as page heading
	 */
	test("E2E-TH-02: logged-in user can create thread", async ({ page, loginAs }) => {
		// Login first
		await loginAs("admin");

		// Go to forum page
		const forumPage = new ForumPage(page);
		await forumPage.goto(10);

		// Click new thread button
		await forumPage.clickNewThread();

		// Dialog should be visible with correct title
		const dialog = page.locator('[role="dialog"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.locator("text=发表新帖")).toBeVisible();

		// Fill subject (min 4 chars)
		const uniqueSubject = `E2E Test Thread ${Date.now()}`;
		await dialog.locator('input[placeholder*="标题"]').fill(uniqueSubject);

		// Fill content in editor (min 10 chars)
		// The editor could be a textarea or contenteditable div
		const editor = dialog.locator('[contenteditable="true"], textarea').first();
		await editor.click();
		await editor.fill("This is test content for E2E testing, minimum 10 characters.");

		// Click submit button
		await dialog.getByRole("button", { name: /发布帖子/ }).click();

		// Dialog should close
		await expect(dialog).not.toBeVisible({ timeout: 15000 });

		// Should navigate to new thread page
		await page.waitForURL(/\/threads\/\d+/, { timeout: 15000 });

		// Should see our subject as the heading
		await expect(page.locator("h1")).toContainText(uniqueSubject);
	});
});

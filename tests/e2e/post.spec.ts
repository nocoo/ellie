// tests/e2e/post.spec.ts — E2E-PO Post Flow Tests
// Ref: docs/e2e-test-design.md §E2E-PO: Post Flow
// Note: Reply/edit/delete moved to post-crud.spec.ts (E2E-PR)

import { expect, test } from "./fixtures/base";
import { ThreadPage } from "./pages/thread.page";

// Stateful tests must run serially to avoid race conditions
test.describe.configure({ mode: "serial" });

test.describe("E2E-PO: Post Flow", () => {
	/**
	 * E2E-PO-01: View Posts
	 * Given I navigate to /threads/662174
	 * Then I should see multiple post cards
	 * And each post should have author sidebar
	 * And each post should have content area
	 */
	test("E2E-PO-01: view posts shows cards with author and content", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174);

		// Should have at least one post card
		const postCards = threadPage.postCards;
		await expect(postCards.first()).toBeVisible();

		// Check first post has author link
		const firstPost = postCards.first();
		const authorLink = firstPost.locator('a[href^="/users/"]');
		await expect(authorLink.first()).toBeVisible();

		// Check first post has content
		const content = firstPost.locator(".prose").first();
		await expect(content).toBeVisible();
	});
});

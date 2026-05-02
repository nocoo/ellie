// tests/e2e/thread.spec.ts — E2E-TH Thread Flow Tests
// Ref: docs/e2e-test-design.md §E2E-TH: Thread Flow (2 specs)
// Note: Thread creation moved to thread-crud.spec.ts (E2E-TC)

import { expect, test } from "./fixtures/base";
import { ThreadPage } from "./pages/thread.page";

// Stateful tests must run serially to avoid race conditions
test.describe.configure({ mode: "serial" });

test.describe("E2E-TH: Thread Flow", () => {
	/**
	 * E2E-TH-01: View Thread Detail
	 * Given I navigate to /threads/662174
	 * Then I should see thread subject
	 * And I should see author info
	 * And I should see post content
	 */
	test("E2E-TH-01: view thread detail shows subject and posts", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		const threadPage = new ThreadPage(page);
		await threadPage.goto(662174);

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
		const postContent = firstPost.locator(".prose").first();
		await expect(postContent).toBeVisible();
	});
});

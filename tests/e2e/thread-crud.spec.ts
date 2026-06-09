// tests/e2e/thread-crud.spec.ts — E2E-TC Thread CRUD Tests
// Covers: Create thread, view it. Requires e2etest user with posting permissions.
// Uses serial mode to ensure create → view order.

import { expect, test } from "./fixtures/base";
import { ForumPage } from "./pages/forum.page";

test.describe.configure({ mode: "serial" });

test.describe("E2E-TC: Thread CRUD", () => {
	let createdThreadUrl = "";

	/**
	 * E2E-TC-01: Create New Thread
	 * Given I am logged in and on a forum page
	 * When I click "发表新帖"
	 * And fill subject and content
	 * And click "发布主题"
	 * Then I should be navigated to the new thread page
	 */
	test("E2E-TC-01: create new thread", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const forumPage = new ForumPage(page);
		await forumPage.goto(1); // Test Forum 1 from seed data

		// Click new thread button
		await forumPage.newThreadButton.click();

		// Dialog should appear with "发表新帖"
		const dialog = page.locator('[role="dialog"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("发表新帖")).toBeVisible();

		// Fill subject (min 4 chars per validation)
		const uniqueSubject = `E2E Thread ${Date.now()}`;
		const subjectInput = dialog.locator('input[placeholder*="标题"]');
		await subjectInput.fill(uniqueSubject);

		// Fill content in editor (min 10 chars)
		const editor = dialog.locator('[contenteditable="true"]').first();
		await editor.click();
		await editor.pressSequentially("This is E2E test content, at least 10 chars long.");

		// Click submit button "发布主题"
		const submitButton = dialog.getByRole("button", { name: /发布主题/ });
		await submitButton.click();

		// Dialog should close and navigate to new thread
		await expect(dialog).not.toBeVisible({ timeout: 15000 });
		await page.waitForURL(/\/threads\/\d+/, { timeout: 15000 });

		// Save URL for next test
		createdThreadUrl = page.url();

		// Should see our subject as the heading
		await expect(page.locator("h1")).toContainText(uniqueSubject);
	});

	/**
	 * E2E-TC-02: View Created Thread
	 * Given the thread was created in TC-01
	 * When I navigate to it
	 * Then I should see the thread content
	 */
	test("E2E-TC-02: view the created thread", async ({ page, loginAs }) => {
		// biome-ignore lint/suspicious/noSkippedTests: serial test depends on TC-01 succeeding
		test.skip(!createdThreadUrl, "TC-01 must pass first");

		await loginAs("e2etest");
		await page.goto(createdThreadUrl);
		await page.waitForLoadState("networkidle");

		// Should have heading
		await expect(page.locator("h1")).toBeVisible();

		// Should have post content with our text
		const postContent = page.locator(".prose").first();
		await expect(postContent).toBeVisible();
		await expect(postContent).toContainText("E2E test content");
	});
});

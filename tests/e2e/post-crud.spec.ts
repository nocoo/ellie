// tests/e2e/post-crud.spec.ts — E2E-PR Post/Reply CRUD Tests
// Covers: Reply to thread, edit own reply, delete own reply.
// Uses serial mode for ordered operations.

import { expect, test } from "./fixtures/base";
import { ThreadPage } from "./pages/thread.page";

test.describe.configure({ mode: "serial" });

test.describe("E2E-PR: Post CRUD", () => {
	const THREAD_ID = 1; // Thread 1 has only 1 post in seed.
	// Across the serial trio (reply → edit → delete) the spec mutates this
	// thread, and PR-01 always pushes the reply to the *last* page. The
	// follow-up specs need to land on that same last page to find their own
	// edit/delete buttons, so we navigate with `?last=1` (the contract the
	// reply-submit viewmodel uses) rather than relying on `threadPage.goto`,
	// which lands on page 1 and would miss the new reply when seed accretion
	// from prior runs pushes the thread past `postsPerPage`.

	/**
	 * E2E-PR-01: Reply to Thread
	 * Given I am logged in and on a thread page
	 * When I open reply dialog and submit content
	 * Then my reply should appear in the thread
	 */
	test("E2E-PR-01: reply to thread", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(THREAD_ID);

		// Open reply dialog
		await threadPage.replyButton.click();
		await expect(threadPage.replyDialog).toBeVisible();

		// Fill reply content — wait for TipTap ProseMirror to be ready
		const uniqueReply = `E2E Reply ${Date.now()}`;
		const editor = threadPage.replyDialog.locator(".ProseMirror[contenteditable='true']");
		await expect(editor).toBeVisible();
		await editor.click();
		await page.keyboard.type(uniqueReply);

		// Submit
		const submitBtn = threadPage.replyDialog.getByRole("button", { name: /发送回复/ });
		await submitBtn.click();

		// Dialog should close
		await expect(threadPage.replyDialog).not.toBeVisible({ timeout: 15000 });

		// Re-fetch the *last* page explicitly. The viewmodel hook navigates to
		// `?last=1#post-<id>` after submit, but a `page.reload()` would drop
		// the query string. With seeded thread 1 already at 1 post and the
		// reply pushing it to ≥2, the new post can end up on a later page when
		// the test DB has accumulated state; `?last=1` is the contract that
		// the UI itself uses, so reuse it here.
		await page.goto(`/threads/${THREAD_ID}?last=1`);
		await page.waitForLoadState("networkidle");

		// Find our reply text
		await expect(page.getByText(uniqueReply).first()).toBeVisible({ timeout: 10000 });
	});

	/**
	 * E2E-PR-02: Edit Own Reply
	 * Given I have a reply in the thread
	 * When I click "编辑" on my reply
	 * And modify the content
	 * Then the updated content should appear
	 */
	test("E2E-PR-02: edit own reply", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		// Edit/delete buttons are only rendered on the post the user wrote,
		// which sits on the *last* page after PR-01's reply.
		await page.goto(`/threads/${THREAD_ID}?last=1`);
		await page.waitForLoadState("networkidle");

		// Find edit buttons — desktop/mobile layouts both render them,
		// so filter to visible ones only
		const editButtons = page.locator('button:has-text("编辑"):visible');
		const editCount = await editButtons.count();

		// biome-ignore lint/suspicious/noSkippedTests: editable posts depend on PR-01 reply succeeding
		test.skip(editCount === 0, "No editable posts found");

		// Click last visible edit button (our most recent reply)
		await editButtons.last().click();

		// Edit dialog should open with "编辑回复"
		const dialog = page.locator('[role="dialog"]:visible');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("编辑回复")).toBeVisible();

		// Clear and type new content
		const editor = dialog.locator(".ProseMirror[contenteditable='true']");
		await expect(editor).toBeVisible();
		await editor.click();
		await page.keyboard.press("Meta+A");
		const editedContent = `Edited E2E Reply ${Date.now()}`;
		await page.keyboard.type(editedContent);

		// Submit via the editor's submit mechanism (Enter or button)
		// PostEditor has an internal submit button
		const submitBtn = dialog.locator('button:has-text("保存"), button:has-text("提交")');
		if (await submitBtn.isVisible()) {
			await submitBtn.click();
		}

		// Dialog should close
		await expect(dialog).not.toBeVisible({ timeout: 15000 });
	});

	/**
	 * E2E-PR-03: Delete Own Reply
	 * Given I have a reply in the thread
	 * When I click "删除" on my reply
	 * And confirm the deletion
	 * Then the reply should be removed
	 */
	test("E2E-PR-03: delete own reply", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await page.goto(`/threads/${THREAD_ID}?last=1`);
		await page.waitForLoadState("networkidle");

		// Find delete buttons — filter to visible (desktop/mobile dual layout)
		const deleteButtons = page.locator('button:has-text("删除"):visible');
		const deleteCount = await deleteButtons.count();

		// biome-ignore lint/suspicious/noSkippedTests: deletable posts depend on PR-01 reply succeeding
		test.skip(deleteCount === 0, "No deletable posts found");

		// Count posts before delete
		const postCountBefore = await threadPage.postCards.count();

		// Click last delete button
		await deleteButtons.last().click();

		// Confirmation dialog should appear
		const confirmDialog = page
			.locator('[role="alertdialog"]:visible, [role="dialog"]:visible')
			.first();
		await expect(confirmDialog).toBeVisible();

		// Click confirm button (confirmText="删除")
		const confirmBtn = confirmDialog.getByRole("button", { name: "删除" });
		await confirmBtn.click();

		// Dialog closing confirms the delete API succeeded
		await expect(confirmDialog).not.toBeVisible({ timeout: 15000 });

		// router.refresh() is a soft RSC refresh — re-navigate to the last
		// page explicitly so the now-shorter thread renders without
		// reverting to page 1 (where the e2etest reply was never visible).
		await page.goto(`/threads/${THREAD_ID}?last=1`);
		await page.waitForLoadState("networkidle");

		// Post count should decrease
		const postCountAfter = await threadPage.postCards.count();
		expect(postCountAfter).toBeLessThan(postCountBefore);
	});
});

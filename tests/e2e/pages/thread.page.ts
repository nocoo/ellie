// tests/e2e/pages/thread.page.ts — ThreadPage Page Object
// Ref: docs/e2e-test-design.md §Page Object Corrections

import type { Page } from "@playwright/test";
import { DIALOG, THREAD } from "../fixtures/selectors";

export class ThreadPage {
	constructor(private page: Page) {}

	async goto(threadId: number) {
		await this.page.goto(`/threads/${threadId}`);
		await this.page.waitForLoadState("networkidle");
	}

	/** Thread subject heading */
	get heading() {
		return this.page.locator("h1");
	}

	/** Breadcrumbs navigation */
	get breadcrumbs() {
		return this.page.locator('nav[aria-label="breadcrumb"]');
	}

	/** Post cards */
	get postCards() {
		return this.page.locator(THREAD.postCard).filter({ has: this.page.locator(THREAD.postContent) });
	}

	/** Author info in post sidebar */
	get authorInfo() {
		return this.page.locator('a[href^="/users/"]').first();
	}

	/** Reply button in floating actions or post bar */
	get replyButton() {
		return this.page.locator(THREAD.replyButton).first();
	}

	/** Reply dialog */
	get replyDialog() {
		return this.page.locator(DIALOG.overlay);
	}

	/** Reply dialog title */
	get replyDialogTitle() {
		return this.replyDialog.locator("text=回复帖子");
	}

	/** Editor in reply dialog */
	get replyEditor() {
		// Could be textarea or rich editor
		return this.replyDialog.locator("textarea, [contenteditable=true]").first();
	}

	/** Submit reply button */
	get submitReplyButton() {
		return this.replyDialog.getByRole("button", { name: "发送回复" });
	}

	/** Open reply dialog */
	async openReplyDialog() {
		await this.replyButton.click();
		await this.replyDialog.waitFor({ state: "visible" });
	}

	/** Submit a reply with given content */
	async submitReply(content: string) {
		await this.openReplyDialog();
		await this.replyEditor.fill(content);
		await this.submitReplyButton.click();
		await this.replyDialog.waitFor({ state: "hidden" });
	}
}

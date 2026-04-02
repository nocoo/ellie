// tests/e2e/pages/forum.page.ts — ForumPage Page Object
// Ref: docs/e2e-test-design.md §Page Object Corrections

import type { Page } from "@playwright/test";
import { DIALOG, FORUM } from "../fixtures/selectors";

export class ForumPage {
	constructor(private page: Page) {}

	async goto(forumId: number) {
		await this.page.goto(`/forums/${forumId}`);
		await this.page.waitForLoadState("networkidle");
	}

	/** Forum title heading */
	get heading() {
		return this.page.locator("h1");
	}

	/** New thread button - text is "发表新帖" */
	get newThreadButton() {
		return this.page.locator(FORUM.newThreadButton);
	}

	/** Thread list container */
	get threadList() {
		return this.page.locator('[data-testid="thread-list"], [class*="divide-y"]');
	}

	/** Individual thread items */
	get threadItems() {
		return this.page.locator('a[href^="/threads/"]');
	}

	/** Breadcrumbs navigation */
	get breadcrumbs() {
		return this.page.locator('nav[aria-label="breadcrumb"]');
	}

	/** Empty state message */
	get emptyState() {
		return this.page.locator("text=暂无帖子");
	}

	/** Click new thread button and wait for dialog */
	async clickNewThread() {
		await this.newThreadButton.click();
		await this.page.locator(DIALOG.overlay).waitFor({ state: "visible" });
	}
}

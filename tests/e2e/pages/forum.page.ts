// tests/e2e/pages/forum.page.ts — ForumPage Page Object
// Ref: docs/e2e-test-design.md §Page Object Corrections

import type { Page } from "@playwright/test";
import { DIALOG, FORUM } from "../fixtures/selectors";

export class ForumPage {
	constructor(private page: Page) {}

	async goto(forumId: number) {
		await this.page.goto(`/forums/${forumId}`);
		await this.page.waitForLoadState("load");
	}

	/** Forum title heading */
	get heading() {
		return this.page.locator("h1");
	}

	/** New thread button - text is "发表新帖" */
	get newThreadButton() {
		return this.page.locator(FORUM.newThreadButton).first();
	}

	/** Thread list container - inside Card > CardContent */
	get threadList() {
		// Real DOM: Card > CardContent > div containing ThreadItems
		return this.page.locator('[class*="CardContent"] > div, .p-0 > div').filter({
			has: this.page.locator('a[href^="/threads/"]'),
		});
	}

	/** Individual thread items */
	get threadItems() {
		return this.page.locator('a[href^="/threads/"]');
	}

	/** Breadcrumbs navigation */
	get breadcrumbs() {
		return this.page.getByRole("navigation", { name: "面包屑" });
	}

	/** Empty state message */
	get emptyState() {
		return this.page.getByText("暂无主题", { exact: true });
	}

	/** Click new thread button and wait for dialog */
	async clickNewThread() {
		await this.newThreadButton.click();
		await this.page.locator(DIALOG.overlay).waitFor({ state: "visible" });
	}
}

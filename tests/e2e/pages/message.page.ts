// tests/e2e/pages/message.page.ts — MessagePage Page Object

import type { Page } from "@playwright/test";

export class MessagePage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto("/messages");
		// /messages issues an async fetch for the inbox list; "load" returns
		// before that resolves and the message list / empty state is mounted.
		// We can't rely on networkidle either (HMR websockets keep the network
		// busy), so wait explicitly for the content shape the tests check.
		await this.page
			.locator('a[href^="/messages/"], :text("收信箱为空"), :text("发信箱为空")')
			.first()
			.waitFor({ state: "visible", timeout: 15_000 })
			.catch(() => {
				/* fall through — the test's own assertions will surface the failure */
			});
	}

	/** Page heading — h1 "站内信" */
	get heading() {
		return this.page.locator("h1");
	}

	/** Message list items (links to /messages/{id}) */
	get messageItems() {
		return this.page.locator('a[href^="/messages/"]');
	}

	/** Compose button — "写站内信" */
	get composeButton() {
		return this.page.locator('button:has-text("写站内信")');
	}

	/** Empty state — "收信箱为空" or "发信箱为空" */
	get emptyState() {
		return this.page.getByText(/收信箱为空|发信箱为空/);
	}

	/** Compose dialog */
	get composeDialog() {
		return this.page.locator('[role="dialog"]');
	}
}

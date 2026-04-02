// tests/e2e/pages/user.page.ts — UserPage Page Object
// Ref: docs/e2e-test-design.md §E2E-NV-04

import type { Page } from "@playwright/test";

export class UserPage {
	constructor(private page: Page) {}

	async goto(userId: number) {
		await this.page.goto(`/users/${userId}`);
		await this.page.waitForLoadState("networkidle");
	}

	/** User avatar image */
	get avatar() {
		return this.page.locator(".h-16.w-16 img, .avatar img").first();
	}

	/** Username heading */
	get username() {
		return this.page.locator("h1");
	}

	/** User role badge */
	get roleBadge() {
		return this.page.locator('[class*="badge"]').first();
	}

	/** Stats cards (threads/posts/digest/credits) */
	get statsCards() {
		return this.page.locator(".grid-cols-4 > a, .grid-cols-4 > div").filter({
			has: this.page.locator("p.text-2xl"),
		});
	}

	/** Threads count card */
	get threadsCard() {
		return this.page.locator('a[href*="tab=threads"]');
	}

	/** Posts count card */
	get postsCard() {
		return this.page.locator('a[href*="tab=posts"]');
	}

	/** Tab navigation */
	get tabNav() {
		return this.page.locator(".border-b .flex").filter({
			has: this.page.locator("a, span"),
		});
	}

	/** Threads tab */
	get threadsTab() {
		return this.page.locator('a[href*="tab=threads"], span:has-text("主题")');
	}

	/** Posts tab */
	get postsTab() {
		return this.page.locator('a[href*="tab=posts"], span:has-text("回帖")');
	}

	/** Digest tab */
	get digestTab() {
		return this.page.locator('a[href*="tab=digest"], span:has-text("精华")');
	}

	/** Navigate to threads tab */
	async goToThreadsTab() {
		await this.threadsCard.click();
		await this.page.waitForLoadState("networkidle");
	}

	/** Navigate to posts tab */
	async goToPostsTab() {
		await this.postsCard.click();
		await this.page.waitForLoadState("networkidle");
	}
}

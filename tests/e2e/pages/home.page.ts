// tests/e2e/pages/home.page.ts — HomePage Page Object
// Ref: docs/e2e-test-design.md §Page Object Corrections

import type { Page } from "@playwright/test";
import { NAV } from "../fixtures/selectors";

export class HomePage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto("/");
		await this.page.waitForLoadState("networkidle");
	}

	/** Site logo */
	get logo() {
		return this.page.locator(NAV.logo);
	}

	/** Forum group containers */
	get forumGroups() {
		return this.page.locator('[data-testid="forum-groups"] > div, .space-y-4 > div').filter({ has: this.page.locator("h2") });
	}

	/** Digest showcase section */
	get digestShowcase() {
		return this.page.locator('a[href="/digest"]').first();
	}

	/** Home footer with stats */
	get homeFooter() {
		return this.page.locator("footer, .text-muted-foreground").last();
	}

	/** Check if page loaded successfully */
	async isLoaded() {
		// Wait for at least one forum group or the "no forums" message
		const hasGroups = await this.forumGroups.first().isVisible().catch(() => false);
		const hasEmpty = await this.page.locator("text=暂无版块").isVisible().catch(() => false);
		return hasGroups || hasEmpty;
	}
}

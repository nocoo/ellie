// tests/e2e/pages/search.page.ts — SearchPage Page Object
// Ref: docs/e2e-test-design.md §E2E-SE specs

import type { Page } from "@playwright/test";

export class SearchPage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto("/search");
		await this.page.waitForLoadState("networkidle");
	}

	/** Search input field */
	get searchInput() {
		return this.page.locator('input[name="q"]');
	}

	/** Search submit button */
	get searchButton() {
		return this.page.getByRole("button", { name: "搜索" });
	}

	/** Search type tabs (only visible after query) */
	get typeTabs() {
		return this.page.locator(".border-b .flex");
	}

	/** Title search tab */
	get titleTab() {
		return this.page.locator("text=按标题搜索");
	}

	/** Author search tab */
	get authorTab() {
		return this.page.locator("text=按作者搜索");
	}

	/** Search results list */
	get results() {
		return this.page.locator(".divide-y a[href^='/threads/']");
	}

	/** No results message */
	get noResults() {
		return this.page.locator("text=未找到相关结果");
	}

	/** Empty state prompt */
	get emptyPrompt() {
		return this.page.locator("text=输入关键词开始搜索");
	}

	/** Perform a search */
	async search(query: string) {
		await this.searchInput.fill(query);
		await this.searchButton.click();
		await this.page.waitForLoadState("networkidle");
	}

	/** Switch to author search */
	async switchToAuthorSearch() {
		await this.authorTab.click();
		await this.page.waitForLoadState("networkidle");
	}

	/** Switch to title search */
	async switchToTitleSearch() {
		await this.titleTab.click();
		await this.page.waitForLoadState("networkidle");
	}
}

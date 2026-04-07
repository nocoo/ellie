// tests/e2e/pages/search.page.ts — SearchPage Page Object
// Ref: docs/e2e-test-design.md §E2E-SE specs
// Note: Only title search is supported (FTS5). Author search was removed.

import type { Page } from "@playwright/test";

export class SearchPage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto("/search");
		await this.page.waitForLoadState("networkidle");
	}

	/** Search input field - specifically the one in the main content (name="q") */
	get searchInput() {
		// Target the main search input, not the header search box
		return this.page.locator('main input[name="q"]');
	}

	/** Search submit button */
	get searchButton() {
		// Target the button inside main content
		return this.page.locator("main").getByRole("button", { name: "搜索" });
	}

	/** Search results list */
	get results() {
		return this.page.locator(
			'[data-testid="search-results"] a[href^="/threads/"], .divide-y a[href^="/threads/"]',
		);
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
}

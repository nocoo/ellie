// tests/e2e/fixtures/base.ts — Extended Playwright fixtures
// Ref: docs/e2e-test-design.md §Fixtures
// Pattern: surety project Page Object Model

import { test as base, type Page } from "@playwright/test";
import { FORM } from "./selectors";

// ---------------------------------------------------------------------------
// Custom fixtures
// ---------------------------------------------------------------------------

export interface TestFixtures {
	/** Navigate to a path and wait for network idle */
	navigateTo: (path: string) => Promise<void>;

	/** Log in as a specific user via login form */
	loginAs: (username: string) => Promise<void>;
}

export const test = base.extend<TestFixtures>({
	navigateTo: async ({ page }, use) => {
		const navigateTo = async (path: string) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
		};
		await use(navigateTo);
	},

	loginAs: async ({ page }, use) => {
		const loginAs = async (username: string) => {
			await page.goto("/login");
			await page.fill(FORM.usernameInput, username);
			// Mock auth rule: password === username
			await page.fill(FORM.passwordInput, username);
			await page.click(FORM.submitButton);
			// Wait for redirect away from login page
			await page.waitForURL((url) => !url.pathname.includes("/login"), {
				timeout: 10000,
			});
		};
		await use(loginAs);
	},
});

export { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Utility: Wait for skeleton or content
// ---------------------------------------------------------------------------

/**
 * Wait for either skeleton or actual content to be visible.
 * Pattern from dove project: skeleton-aware assertions.
 */
export async function waitForSkeletonOrContent(
	page: Page,
	skeletonSelector: string,
	contentSelector: string,
	timeout = 10000
): Promise<void> {
	const skeleton = page.locator(skeletonSelector);
	const content = page.locator(contentSelector);

	await skeleton.or(content).first().waitFor({ timeout });

	// If skeleton was shown, wait for content to replace it
	if (await skeleton.isVisible()) {
		await content.waitFor({ timeout });
	}
}

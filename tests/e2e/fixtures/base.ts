// tests/e2e/fixtures/base.ts — Extended Playwright fixtures
// Ref: docs/e2e-test-design.md §Fixtures
// Pattern: surety project Page Object Model

import { type Page, test as base } from "@playwright/test";
import { FORM } from "./selectors";

// ---------------------------------------------------------------------------
// E2E Test Credentials
// ---------------------------------------------------------------------------

/**
 * Default E2E test user credentials.
 * This user is created in the production database specifically for E2E testing.
 * Username: e2etest, Password: e2etest123
 */
const E2E_TEST_USER = {
	username: "e2etest",
	password: "e2etest123",
};

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
			await page.waitForLoadState("networkidle");

			// Use E2E test user credentials
			// The `username` parameter is kept for API compatibility but we use the actual test user
			const testUser = E2E_TEST_USER;

			await page.fill(FORM.usernameInput, testUser.username);
			await page.fill(FORM.passwordInput, testUser.password);
			await page.click(FORM.submitButton);

			// Wait for redirect away from login page
			await page.waitForURL((url) => !url.pathname.includes("/login"), {
				timeout: 15000,
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
	timeout = 10000,
): Promise<void> {
	const skeleton = page.locator(skeletonSelector);
	const content = page.locator(contentSelector);

	await skeleton.or(content).first().waitFor({ timeout });

	// If skeleton was shown, wait for content to replace it
	if (await skeleton.isVisible()) {
		await content.waitFor({ timeout });
	}
}

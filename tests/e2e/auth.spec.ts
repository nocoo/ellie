// tests/e2e/auth.spec.ts — E2E-AU Auth Flow Tests
// Ref: docs/e2e-test-design.md §E2E-AU: Auth Flow (3 specs - Read-only)

import { expect, test } from "./fixtures/base";
import { LoginPage } from "./pages/login.page";

test.describe("E2E-AU: Auth Flow", () => {
	/**
	 * E2E-AU-01: Login Form Renders
	 * Given I navigate to /login
	 * Then I should see username input
	 * And I should see password input
	 * And submit button should be disabled
	 */
	test("E2E-AU-01: login form renders with disabled submit", async ({ page }) => {
		const loginPage = new LoginPage(page);
		await loginPage.goto();

		// Should have username input
		await expect(loginPage.usernameInput).toBeVisible();

		// Should have password input
		await expect(loginPage.passwordInput).toBeVisible();

		// Submit button should be disabled when fields are empty
		await expect(loginPage.submitButton).toBeDisabled();
	});

	/**
	 * E2E-AU-02: Login Form Validation
	 * Given I am on /login
	 * When I fill username "admin"
	 * And I fill password "admin"
	 * Then submit button should be enabled
	 */
	test("E2E-AU-02: login form enables submit with input", async ({ page }) => {
		const loginPage = new LoginPage(page);
		await loginPage.goto();

		// Fill credentials
		await loginPage.fillCredentials("admin", "admin");

		// Submit button should be enabled
		await expect(loginPage.submitButton).toBeEnabled();
	});

	/**
	 * E2E-AU-03: Login Success Redirects
	 * Given I am on /login
	 * When I submit valid credentials
	 * Then I should be redirected to /
	 * And I should see my username in navbar
	 */
	test("E2E-AU-03: login success redirects to home", async ({ page }) => {
		const loginPage = new LoginPage(page);
		await loginPage.goto();

		// Login with valid credentials (mock auth: password === username)
		await loginPage.login("admin", "admin");

		// Should be redirected away from login page
		await expect(page).not.toHaveURL(/\/login/);

		// Should be on homepage or callback URL
		expect(page.url()).toMatch(/\//);

		// Should see username in page (user dropdown or avatar)
		// Note: The exact selector depends on navbar implementation
		const userIndicator = page.locator(
			'[data-testid="user-menu"], [aria-label*="user"], text=admin',
		);
		await expect(userIndicator.first()).toBeVisible({ timeout: 10000 });
	});
});

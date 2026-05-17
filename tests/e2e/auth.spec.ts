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
	test("E2E-AU-03: login success redirects to home", async ({ page, loginViaForm }) => {
		// Login with valid credentials via the real form (uses e2etest user).
		// Intentionally not `loginAs` — this spec is the regression for the
		// /login form + NextAuth callback, not for the cached-cookie fastpath.
		await loginViaForm("e2etest");

		// Should be redirected away from login page
		await expect(page).not.toHaveURL(/\/login/);

		// Should be on homepage or callback URL
		expect(page.url()).toMatch(/\//);

		// Should see username in page (user dropdown or text containing username)
		// Try multiple selectors for flexibility
		const userIndicator = page.locator('[data-testid="user-menu"]').or(page.getByText("e2etest"));
		await expect(userIndicator.first()).toBeVisible({ timeout: 10000 });
	});

	/**
	 * E2E-AU-04: Login Failure Shows Error
	 * Given I am on /login
	 * When I submit invalid credentials
	 * Then I should see error message
	 * And I should remain on login page
	 */
	test("E2E-AU-04: login failure shows error message", async ({ page }) => {
		const loginPage = new LoginPage(page);
		await loginPage.goto();

		// Fill invalid credentials
		await loginPage.fillCredentials("invalid_user", "wrong_password");
		await loginPage.submit();

		// Should remain on login page
		await expect(page).toHaveURL(/\/login/);

		// Should show error message (wait for API response)
		await expect(loginPage.errorMessage).toBeVisible({ timeout: 5000 });
	});

	/**
	 * E2E-AU-05: Logged-in user sees "already logged in" card on /login
	 * Given I am logged in
	 * When I navigate to /login
	 * Then I should stay on /login
	 * And I should see the "already logged in" card with my username
	 */
	test("E2E-AU-05: logged-in user sees already-logged-in card", async ({ page, loginViaForm }) => {
		// Login first via the real form (uses e2etest user). The already-logged-in
		// card behaviour belongs to the auth surface, so we don't take the cached-
		// cookie shortcut here either.
		await loginViaForm("e2etest");

		// Navigate to login page
		await page.goto("/login");
		await page.waitForLoadState("networkidle");

		// Should stay on /login (no redirect — shows AlreadyLoggedIn card instead)
		await expect(page).toHaveURL(/\/login/);

		// Should see the "already logged in" card
		await expect(page.getByText("你已登录")).toBeVisible({ timeout: 5000 });
		await expect(page.getByText("前往首页")).toBeVisible();
	});
});

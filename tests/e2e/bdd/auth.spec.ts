import { LoginPage } from "../pages/login.page";
import { expect, test } from "./fixtures";

test.describe("Feature: Authentication", () => {
	test("Given I am not logged in, When I open /login, Then the username + password inputs render and the submit button is initially disabled", async ({
		page,
	}) => {
		const loginPage = new LoginPage(page);
		await loginPage.goto();

		await expect(loginPage.usernameInput).toBeVisible();
		await expect(loginPage.passwordInput).toBeVisible();
		await expect(loginPage.submitButton).toBeDisabled();
	});

	test("Given I submit valid credentials via loginAs, When the credentials callback completes, Then I am redirected off /login and the user indicator is visible", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		await expect(page).not.toHaveURL(/\/login/);
		expect(page.url()).toMatch(/\//);

		const userIndicator = page.locator('[data-testid="user-menu"]').or(page.getByText("e2etest"));
		await expect(userIndicator.first()).toBeVisible({ timeout: 10_000 });
	});

	test("Given I am not logged in, When I open /messages, Then I land on /login with the redirect param preserving /messages", async ({
		page,
	}) => {
		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		const url = new URL(page.url());
		expect(url.pathname).toBe("/login");
		expect(url.origin).toContain("localhost");
		expect(url.searchParams.get("redirect")).toContain("/messages");
	});

	test("Given I am logged in, When I open /messages, Then I stay on /messages with no /login bounce", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		expect(page.url()).toContain("/messages");
		expect(page.url()).not.toContain("/login");
	});
});

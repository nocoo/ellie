// tests/e2e/bdd/auth.spec.ts — Feature: Authentication (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 2.1), §5.3 (合并表)
//
// Merges 3 legacy specs (already-logged-in + auth + redirect, 10 tests) into
// tests/e2e/bdd/auth.spec.ts (8 BDD scenarios). The two skipOnCI tests from
// auth.spec.ts are preserved with the same conditional. Traceability map
// lives in the commit message body.
//
// Note: docs/23 §5.3 says auth was 3 tests (= "3 specs read-only" per the
// legacy header), but the file actually contains 5 tests (2 of them skipped
// on CI). Total is 10 → 8 BDD scenarios with 2 merges, kept inside Phase 2.1
// scope; the doc count drift is called out in the commit body.

import { LoginPage } from "../pages/login.page";
import { expect, test } from "./fixtures";

// Cap.js auto-PoW takes 30–45 s on the free GitHub Actions runner, which
// blows the per-test budget for any spec that drives the real form. Kept
// identical to the legacy `skipOnCI` switch in auth.spec.ts.
const skipOnCI = process.env.CI ? test.skip : test;

test.describe("Feature: Authentication", () => {
	test("Given I am not logged in, When I open /login, Then the username + password inputs render and the submit button is initially disabled", async ({
		page,
	}) => {
		// Given: anonymous user opens /login
		const loginPage = new LoginPage(page);
		await loginPage.goto();

		// Then: both inputs render
		await expect(loginPage.usernameInput).toBeVisible();
		await expect(loginPage.passwordInput).toBeVisible();

		// Then: submit is gated until Cap.js solves + fields filled
		await expect(loginPage.submitButton).toBeDisabled();
	});

	skipOnCI(
		"Given I am on the login form, When I fill username and password and Cap.js auto-PoW completes, Then the submit button becomes enabled",
		async ({ page }) => {
			// Given: anonymous user on /login
			const loginPage = new LoginPage(page);
			await loginPage.goto();

			// When: fill any credentials (the assertion is about the CAPTCHA
			// gate, not whether the credentials are valid)
			await loginPage.fillCredentials("admin", "admin");

			// Then: submit enables once Cap.js completes. Local PoW solves in
			// seconds; CI runners take 30–45 s, so we mirror the form-login
			// helper's 60 s budget here.
			await expect(loginPage.submitButton).toBeEnabled({ timeout: 60_000 });
		},
	);

	test("Given I submit valid credentials via loginAs, When the credentials callback completes, Then I am redirected off /login and the user indicator is visible", async ({
		page,
		loginAs,
	}) => {
		// Given/When: loginAs mints a session via the test backdoor (skipping
		// the real Cap.js gate so this test stays under the per-test budget on
		// CI). The product behavior under test is "post-login redirect happens
		// and the user indicator renders" — which loginAs proves end-to-end
		// via the NextAuth credentials callback.
		await loginAs("e2etest");

		// Then: we're off /login
		await expect(page).not.toHaveURL(/\/login/);
		expect(page.url()).toMatch(/\//);

		// Then: user indicator renders (data-testid OR username text)
		// CSS fallback: not every page chrome variant exposes data-testid; the
		// username text in a dropdown is the cross-layout fallback.
		const userIndicator = page.locator('[data-testid="user-menu"]').or(page.getByText("e2etest"));
		await expect(userIndicator.first()).toBeVisible({ timeout: 10_000 });
	});

	skipOnCI(
		"Given I submit invalid credentials, When the API rejects them, Then I stay on /login and an error message renders",
		async ({ page }) => {
			// Given: anonymous user on /login
			const loginPage = new LoginPage(page);
			await loginPage.goto();

			// When: submit wrong credentials through the real form
			await loginPage.fillCredentials("invalid_user", "wrong_password");
			await loginPage.submit();

			// Then: still on /login
			await expect(page).toHaveURL(/\/login/);

			// Then: error surfaces (data-testid OR .text-destructive Tailwind class)
			await expect(loginPage.errorMessage).toBeVisible({ timeout: 5_000 });
		},
	);

	test("Given I am already logged in, When I open /login, Then I see the 你已登录 card with a 前往首页 button that returns me to /", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: navigate to /login (no redirect — AlreadyLoggedIn card renders)
		await page.goto("/login");
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveURL(/\/login/);

		// Then: card + button render. Merges AU-05 (card present) + AL-01
		// (button click returns home) into one scenario because the assertion
		// chain is contiguous — both used the same setup and the AU-05 card
		// assertion is a strict prefix of AL-01's flow.
		await expect(page.getByText("你已登录")).toBeVisible({ timeout: 15_000 });
		const homeBtn = page.getByRole("button", { name: "前往首页" });
		await expect(homeBtn).toBeVisible();
		await homeBtn.click();

		// Then: navigation lands on /
		await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toBe("/");
	});

	test("Given I am already logged in on /login, When I click 切换账号, Then I am signed out and the real login form renders", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /login showing the already-logged-in card
		await loginAs("e2etest");
		await page.goto("/login");
		await expect(page.getByText("你已登录")).toBeVisible({ timeout: 15_000 });

		// When: click the 切换账号 button (label briefly becomes 退出中 mid-flow)
		const switchBtn = page.getByRole("button", { name: /切换账号|退出中/ });
		await expect(switchBtn).toBeVisible();
		await switchBtn.click();

		// Then: page reloads and the real login form takes over
		// Wait via the username input rather than a URL change — the handler
		// calls signOut({ redirect: false }) so we stay on /login and just
		// re-render the server component.
		await expect(page.locator('input[id="username"]')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText("你已登录")).toHaveCount(0);
	});

	test("Given I am not logged in, When I open /messages, Then I land on /login with the redirect param preserving /messages", async ({
		page,
	}) => {
		// Given/When: anonymous request to a protected route
		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		// Then: same-origin redirect to /login (the open-redirect fix #5)
		const url = new URL(page.url());
		expect(url.pathname).toBe("/login");
		expect(url.origin).toContain("localhost");

		// Then: ?redirect= preserves the original target so the post-login
		// hop returns the user where they were going. Merges RD-01 (same-
		// origin redirect) + RD-02 (param preservation) — both observe the
		// same single navigation, so splitting them would only duplicate the
		// goto+waitForLoadState setup.
		expect(url.searchParams.get("redirect")).toContain("/messages");
	});

	test("Given I am logged in, When I open /messages, Then I stay on /messages with no /login bounce", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: open the protected route
		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		// Then: URL is /messages, not /login
		expect(page.url()).toContain("/messages");
		expect(page.url()).not.toContain("/login");
	});
});

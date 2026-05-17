// tests/e2e/already-logged-in.spec.ts — E2E-AL Already-logged-in landing.
//
// Complements E2E-AU-05 (which only asserts the card is shown). These tests
// drive the two interactive elements on the card:
//
//   • E2E-AL-01: "前往首页" button navigates to /
//   • E2E-AL-02: "切换账号" signs the user out and reveals the login form
//
// Both are stateless wrt the database, but E2E-AL-02 mutates the browser
// session (signs out). Playwright contexts are isolated per-test by default
// so this doesn't leak.

import { expect, test } from "./fixtures/base";

test.describe("E2E-AL: Already-logged-in landing", () => {
	test("E2E-AL-01: 前往首页 button navigates to /", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto("/login");

		// The already-logged-in card renders "你已登录" + a "前往首页" button.
		await expect(page.getByText("你已登录")).toBeVisible({ timeout: 15_000 });

		const homeBtn = page.getByRole("button", { name: "前往首页" });
		await expect(homeBtn).toBeVisible();
		await homeBtn.click();

		await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toBe("/");
	});

	test("E2E-AL-02: 切换账号 signs out and reveals the login form", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto("/login");

		await expect(page.getByText("你已登录")).toBeVisible({ timeout: 15_000 });

		// "切换账号" is a button (not anchor) per already-logged-in.tsx.
		const switchBtn = page.getByRole("button", { name: /切换账号|退出中/ });
		await expect(switchBtn).toBeVisible();
		await switchBtn.click();

		// The handler calls signOut({ redirect: false }) then reloads the page.
		// After reload, the server component sees no session → renders the
		// real login form. We wait for the username input as a proxy.
		const usernameInput = page.locator('input[id="username"]');
		await expect(usernameInput).toBeVisible({ timeout: 30_000 });

		// And the "你已登录" copy must be gone.
		await expect(page.getByText("你已登录")).toHaveCount(0);
	});
});

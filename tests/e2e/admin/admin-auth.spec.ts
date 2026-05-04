// tests/e2e/admin/admin-auth.spec.ts — A0 admin auth gate smoke
//
// Verifies the admin layout gate at apps/admin/src/app/(admin)/layout.tsx:
//   1. Anonymous → /admin redirects to /login
//   2. Whitelisted admin cookie → /admin renders the dashboard shell
//   3. Out-of-whitelist cookie → /admin redirects to /login
//
// We assert on layout/shell-level signals (page heading, login form fields)
// rather than dashboard stat numbers — those depend on Worker/D1 state which
// is out of scope for an auth smoke.

import { expect, test } from "./fixtures/admin-base";

test.describe("Admin auth gate", () => {
	test("anonymous /admin redirects to /login", async ({ page }) => {
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/login(\?|$)/);
	});

	test("whitelisted admin cookie reaches dashboard", async ({ page, loginAsAdmin }) => {
		await loginAsAdmin(); // default email is in ADMIN_EMAILS
		await page.goto("/admin");
		// Stay on /admin (not redirected to /login).
		await expect(page).toHaveURL(/\/admin(\/|$)/);
		// Dashboard server component renders heading "仪表盘" even when stats
		// fail to load (it shows an error block but keeps the heading).
		await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
	});

	test("out-of-whitelist cookie is rejected by gate", async ({ page, loginAsAdmin }) => {
		await loginAsAdmin("not-an-admin@example.invalid");
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/login(\?|$)/);
	});
});

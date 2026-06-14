// tests/e2e/bdd/admin/admin-auth.spec.ts — Feature: Admin Authentication Gate (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 4.1), §5.3 (合并表)
//
// 1:1 migration of the legacy admin-auth spec (3 tests) into 3 BDD
// scenarios. No merges: each scenario exercises a distinct auth-gate
// branch (anonymous → /login, whitelisted admin → dashboard, out-of-
// whitelist → /login). Traceability map lives in the commit body.
//
// Imports the admin fixture (loginAsAdmin) from
// tests/e2e/admin/fixtures/admin-base.ts — same source as the legacy
// spec, so cookie minting + AUTH_SECRET + whitelist gating are unchanged.
//
// Collected by the `admin` Playwright project, whose testMatch was widened
// during Stage 1 (playwright.config.ts) to include
// /\/(admin\/[^/]+|bdd\/admin\/[^/]+)\.spec\.ts$/ so this file lands
// automatically. Runs only via scripts/run-l3-admin.ts (port 7032).

import { expect, test } from "../../admin/fixtures/admin-base";

test.describe("Feature: Admin Authentication Gate", () => {
	test("Given I am anonymous, When I open /admin, Then I am redirected to /login", async ({
		page,
	}) => {
		// Given/When: anonymous request to a protected admin route
		await page.goto("/admin");

		// Then: layout gate redirects to /login (legacy A0-01)
		await expect(page).toHaveURL(/\/login(\?|$)/);
	});

	test("Given my email is in ADMIN_EMAILS, When I open /admin with a valid session cookie, Then the dashboard renders the 仪表盘 heading", async ({
		page,
		loginAsAdmin,
	}) => {
		// Given: whitelisted admin session minted via Auth.js v5 cookie
		await loginAsAdmin(); // defaults to E2E_ADMIN_EMAIL / built-in test admin

		// When: navigate to /admin
		await page.goto("/admin");

		// Then: gate passes (URL stays on /admin, not /login)
		await expect(page).toHaveURL(/\/admin(\/|$)/);

		// Then: dashboard server component renders the 仪表盘 heading even
		// when stats fetches error — the legacy A0-02 invariant.
		await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
	});

	test("Given my email is NOT in ADMIN_EMAILS, When I open /admin with a session cookie, Then the gate redirects me to /login", async ({
		page,
		loginAsAdmin,
	}) => {
		// Given: a valid session cookie minted for an email outside ADMIN_EMAILS
		await loginAsAdmin("not-an-admin@example.invalid");

		// When: navigate to /admin
		await page.goto("/admin");

		// Then: gate rejects and redirects to /login (legacy A0-03)
		await expect(page).toHaveURL(/\/login(\?|$)/);
	});
});

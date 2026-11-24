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
	test("Given I am anonymous or out-of-whitelist, When I open /admin, Then I am redirected to /login", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/login(\?|$)/);

		await loginAsAdmin("not-an-admin@example.invalid");
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/login(\?|$)/);
	});

	test("Given my email is in ADMIN_EMAILS, When I open /admin, Then dashboard and statistics render", async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin();
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/admin(\/|$)/);
		await expect(
			page.locator("main [data-basalt-surface-root]").getByRole("heading", { name: "仪表盘" }),
		).toBeVisible();
		await expect(page.getByRole("region", { name: "累计计数" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "内容增长", exact: true })).toBeVisible();
		await expect(page.getByRole("heading", { name: "认证活动", exact: true })).toBeVisible();
	});
});

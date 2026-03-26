// tests/e2e/admin-path.spec.ts — E2E admin page reachability
// Ref: 04-application §4.9.3
//
// Current scope: Verifies admin pages render without errors.
// These are SHALLOW tests — they check pages load, not that admin
// functionality works (e.g. we check sidebar renders, not that
// ban/role-change actually persists).
//
// NOTE: With proxy auth enforcement, these pages now require
// X-Mock-Uid + X-Mock-Role headers. In browser E2E context,
// proxy headers can't be set per-request. These tests work because
// Next.js dev server handles page routes server-side (proxy only
// runs on API and non-static routes in dev mode).
//
// Phase 2 TODO: Test actual admin workflows after pages are wired.

import { expect, test } from "@playwright/test";

test.describe("Page reachability — admin", () => {
	test("admin dashboard page loads", async ({ page }) => {
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/admin/);
	});

	test("admin users page loads", async ({ page }) => {
		await page.goto("/admin/users");
		await expect(page).toHaveURL(/\/admin\/users/);
	});

	test("admin content page loads", async ({ page }) => {
		await page.goto("/admin/content");
		await expect(page).toHaveURL(/\/admin\/content/);
	});

	test("admin forums page loads", async ({ page }) => {
		await page.goto("/admin/forums");
		await expect(page).toHaveURL(/\/admin\/forums/);
	});

	test("admin sidebar navigation renders", async ({ page }) => {
		await page.goto("/admin");
		await expect(page.locator("text=Dashboard")).toBeVisible();
	});
});

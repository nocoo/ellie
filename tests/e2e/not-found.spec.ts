// tests/e2e/not-found.spec.ts — E2E-NF Not-Found & Invalid-Param Routes
//
// These exercise the user-visible error UI for missing or malformed resource
// identifiers. They're stateless and require no authentication, which keeps
// them cheap and stable in the autoresearch bench.
//
// Coverage added by this file:
//   • /threads/<nonexistent-id> → renders "主题不存在" error card with home link
//   • /threads/<non-numeric>    → renders "无效的主题 ID" error card
//   • /users/<nonexistent-id>   → renders "用户不存在" error card
//   • /forums/<non-numeric>     → renders "无效的版块 ID" error card

import { expect, test } from "./fixtures/base";

test.describe("E2E-NF: Not-found & invalid-param routes", () => {
	test("E2E-NF-01: /threads/<nonexistent> shows 主题不存在 with return-home link", async ({
		page,
	}) => {
		// 99,999,999 is well past the seeded thread id range. The page must
		// fail soft rather than crash.
		await page.goto("/threads/99999999");

		const errorMsg = page.getByText(/主题不存在|无法加载主题|Thread not found/i).first();
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		// "返回首页" link should be present so the user can recover.
		const homeLink = page.locator('a[href="/"]', { hasText: "返回首页" });
		await expect(homeLink).toBeVisible();
	});

	test("E2E-NF-02: /threads/<non-numeric> shows 无效的主题 ID", async ({ page }) => {
		await page.goto("/threads/not-a-number");

		const errorMsg = page.getByText(/无效的主题/);
		await expect(errorMsg).toBeVisible({ timeout: 10_000 });

		// Same fallback link, same behaviour.
		const homeLink = page.locator('a[href="/"]', { hasText: "返回首页" });
		await expect(homeLink).toBeVisible();
	});

	test("E2E-NF-03: /users/<nonexistent> shows 用户不存在", async ({ page }) => {
		await page.goto("/users/99999999");

		const errorMsg = page.getByText(/用户不存在|无法加载用户|User not found/i).first();
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });
	});

	test("E2E-NF-04: /forums/<non-numeric> shows 无效的版块 ID", async ({ page }) => {
		await page.goto("/forums/not-a-number");

		const errorMsg = page.getByText(/无效的版块/);
		await expect(errorMsg).toBeVisible({ timeout: 10_000 });

		const homeLink = page.locator('a[href="/"]', { hasText: "返回首页" });
		await expect(homeLink).toBeVisible();
	});
});

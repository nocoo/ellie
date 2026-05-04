// tests/e2e/admin/admin-reports.spec.ts — E2 admin reports smoke
//
// Read-only smoke covering the type-aware list page added in E2:
//   - page renders with "类型" + "状态" filters
//   - per-type rows render the correct target label/link target
//
// We mock /api/admin/reports so this spec does not depend on seed data
// — the real API contract is exercised by unit tests
// (apps/worker/tests/unit/handlers/admin/report.test.ts) and the E4
// integration lifecycle.

import { expect, test } from "./fixtures/admin-base";

interface AdminReport {
	id: number;
	type: "thread" | "post" | "user";
	targetId: number;
	reporterId: number;
	reporterName: string;
	reason: string;
	status: "pending" | "resolved" | "dismissed";
	handlerId: number | null;
	handlerName: string;
	handledAt: number | null;
	createdAt: number;
	threadId: number | null;
	targetTitle: string | null;
	targetName: string | null;
}

const NOW = Math.floor(Date.now() / 1000);

const FIXTURE: AdminReport[] = [
	{
		id: 1,
		type: "thread",
		targetId: 11,
		reporterId: 5,
		reporterName: "alice",
		reason: "垃圾广告",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: NOW,
		threadId: 11,
		targetTitle: "测试主题标题",
		targetName: null,
	},
	{
		id: 2,
		type: "post",
		targetId: 22,
		reporterId: 5,
		reporterName: "alice",
		reason: "违规内容",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: NOW,
		threadId: 33,
		targetTitle: "回帖所在主题",
		targetName: null,
	},
	{
		id: 3,
		type: "user",
		targetId: 44,
		reporterId: 5,
		reporterName: "alice",
		reason: "人身攻击",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: NOW,
		threadId: null,
		targetTitle: null,
		targetName: "bob",
	},
];

test.describe("Admin reports list (E2 smoke)", () => {
	test.beforeEach(async ({ page }) => {
		await page.route("**/api/admin/reports**", async (route) => {
			const url = new URL(route.request().url());
			const typeFilter = url.searchParams.get("type") as "thread" | "post" | "user" | null;
			const filtered = typeFilter ? FIXTURE.filter((r) => r.type === typeFilter) : FIXTURE;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: filtered,
					meta: {
						page: 1,
						pages: 1,
						total: filtered.length,
						limit: 20,
					},
				}),
			});
		});
	});

	test("list renders type column + per-type target labels and links", async ({ page }) => {
		await page.goto("/admin/reports");

		// Header still present
		await expect(page.getByRole("heading", { name: "举报管理" })).toBeVisible();

		// Type filter chip exists — distinguish from status filter via option text.
		await expect(page.locator("select").filter({ hasText: "回帖" })).toBeVisible();

		// thread row → title + admin thread link
		const threadLink = page.getByRole("link", { name: /测试主题标题/ });
		await expect(threadLink).toBeVisible();
		await expect(threadLink).toHaveAttribute("href", "/admin/threads/11");

		// post row → parent thread title + admin thread link to threadId (=33), NOT targetId
		const postLink = page.getByRole("link", { name: /回帖所在主题/ });
		await expect(postLink).toBeVisible();
		await expect(postLink).toHaveAttribute("href", "/admin/threads/33");

		// user row → @username + admin user link
		const userLink = page.getByRole("link", { name: /@bob/ });
		await expect(userLink).toBeVisible();
		await expect(userLink).toHaveAttribute("href", "/admin/users/44");
	});

	test("type filter narrows visible rows to selected type", async ({ page }) => {
		await page.goto("/admin/reports");

		// Wait for initial load (3 rows).
		await expect(page.getByRole("link", { name: /测试主题标题/ })).toBeVisible();

		// AdminFilters renders a bare <select> per filter without an explicit
		// label; differentiate the type select by an option that only it has.
		const typeSelect = page.locator("select").filter({ hasText: "回帖" });
		await typeSelect.selectOption({ label: "用户" });

		// Only the user row should remain.
		await expect(page.getByRole("link", { name: /@bob/ })).toBeVisible();
		await expect(page.getByRole("link", { name: /测试主题标题/ })).toHaveCount(0);
		await expect(page.getByRole("link", { name: /回帖所在主题/ })).toHaveCount(0);
	});
});

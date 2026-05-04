// tests/e2e/admin/admin-logs.spec.ts — F4 admin operation logs smoke
//
// Pure mock-driven smoke for /admin/logs/operations. The page is read-only
// (no mutation paths exist), so this spec focuses on:
//
//   1. list renders all rows + columns
//   2. action filter input round-trips into the request URL (?action=...)
//   3. detail dialog renders pretty-printed JSON when details parses ok
//   4. detail dialog falls back to raw text when details is non-JSON
//
// Mocking strategy
//   - All `**/api/admin/admin-logs**` requests are intercepted. The page reads
//     row data on click rather than re-fetching, so we do NOT mock /:id —
//     keeping the dependency graph minimal per reviewer guidance.
//   - The mock captures the latest action= query so the filter assertion does
//     not race the debounced re-fetch.
//
// Auth
//   - Reuses loginAsAdmin from fixtures/admin-base; same admin project as
//     admin-reports / admin-forums specs (playwright.config.ts → admin →
//     baseURL http://localhost:7032).

import { expect, test } from "./fixtures/admin-base";

const NOW = Math.floor(Date.UTC(2026, 4, 5, 6, 0, 0) / 1000); // 2026-05-05T06:00:00Z

interface AdminLogFixture {
	id: number;
	adminId: number;
	adminName: string;
	action: string;
	targetType: string;
	targetId: number | null;
	details: string;
	ip: string;
	createdAt: number;
}

const FIXTURE: AdminLogFixture[] = [
	{
		id: 101,
		adminId: 1,
		adminName: "alice",
		action: "user.ban",
		targetType: "user",
		targetId: 3,
		details: JSON.stringify({ reason: "spam", actorEmail: "alice@example.com" }),
		ip: "10.0.0.1",
		createdAt: NOW,
	},
	{
		id: 102,
		adminId: 1,
		adminName: "alice",
		action: "forum.reorder",
		targetType: "forum",
		targetId: null,
		details: JSON.stringify({
			count: 2,
			orders: [
				{ id: 10, before: 1, after: 2 },
				{ id: 11, before: 2, after: 1 },
			],
		}),
		ip: "10.0.0.1",
		createdAt: NOW - 60,
	},
	{
		id: 103,
		adminId: 2,
		adminName: "bob",
		action: "setting.update",
		targetType: "setting",
		targetId: null,
		// Intentionally non-JSON — exercises parse-failure fallback.
		details: "legacy plain text payload, not json",
		ip: "10.0.0.2",
		createdAt: NOW - 120,
	},
];

test.describe("Admin operation logs (F4 smoke)", () => {
	let lastRequestUrl = "";

	test.beforeEach(async ({ page, loginAsAdmin }) => {
		await loginAsAdmin();
		lastRequestUrl = "";
		await page.route("**/api/admin/admin-logs**", async (route) => {
			const url = new URL(route.request().url());
			lastRequestUrl = url.toString();
			const actionFilter = url.searchParams.get("action");
			const filtered = actionFilter
				? FIXTURE.filter((row) => row.action === actionFilter)
				: FIXTURE;
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
						timestamp: Date.now(),
						requestId: "e2e-mock",
					},
				}),
			});
		});
	});

	test("list renders all 3 rows with correct columns", async ({ page }) => {
		await page.goto("/admin/logs/operations");

		await expect(page.getByRole("heading", { name: "操作日志" })).toBeVisible();

		// Action codes (rendered as <code>)
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();
		await expect(page.getByText("forum.reorder", { exact: true })).toBeVisible();
		await expect(page.getByText("setting.update", { exact: true })).toBeVisible();

		// Whitelisted target → link
		const userLink = page.getByRole("link", { name: "user#3" });
		await expect(userLink).toBeVisible();
		await expect(userLink).toHaveAttribute("href", "/admin/users/3");

		const forumLink = page.getByRole("link", { name: "forum" });
		await expect(forumLink).toBeVisible();
		await expect(forumLink).toHaveAttribute("href", "/admin/forums");

		// Non-whitelisted (setting) → plain text in the row, NOT a link.
		// Scope to the data table to avoid matching the targetType <option>.
		const settingCell = page.locator("table").getByText("setting", { exact: true });
		await expect(settingCell.first()).toBeVisible();
		await expect(page.getByRole("link", { name: "setting", exact: true })).toHaveCount(0);

		// IP column rendered (font-mono — match by visible text)
		await expect(page.getByText("10.0.0.1").first()).toBeVisible();
		await expect(page.getByText("10.0.0.2").first()).toBeVisible();
	});

	test("action filter forwards ?action=... to the API", async ({ page }) => {
		await page.goto("/admin/logs/operations");

		// Wait for initial load before issuing the filter.
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();

		const searchInput = page.getByPlaceholder("如 user.ban，回车提交");
		await searchInput.fill("user.ban");
		await searchInput.press("Enter");

		// Page re-fetches; only matching row remains visible.
		await expect(page.getByText("forum.reorder", { exact: true })).toHaveCount(0);
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();

		// Mock captured the filter
		expect(lastRequestUrl).toContain("action=user.ban");
	});

	test("detail dialog: JSON details render pretty-printed", async ({ page }) => {
		await page.goto("/admin/logs/operations");
		await expect(page.getByText("user.ban", { exact: true })).toBeVisible();

		await page.getByLabel("查看日志 #101 详情").click();

		const dialog = page.getByRole("dialog", { name: "操作日志详情" });
		await expect(dialog).toBeVisible();

		const pre = dialog.getByTestId("admin-log-details");
		await expect(pre).toBeVisible();
		const text = (await pre.textContent()) ?? "";
		// Pretty-printed JSON has newlines + indentation
		expect(text).toContain("\n");
		expect(text).toContain('"reason"');
		expect(text).toContain('"spam"');
		// Parse-failure marker should NOT appear
		await expect(dialog.getByText("(原始文本，非 JSON)")).toHaveCount(0);

		await dialog.getByRole("button", { name: "关闭" }).click();
		await expect(dialog).toBeHidden();
	});

	test("detail dialog: non-JSON details fall back to raw text without crashing", async ({
		page,
	}) => {
		await page.goto("/admin/logs/operations");
		await expect(page.getByText("setting.update", { exact: true })).toBeVisible();

		await page.getByLabel("查看日志 #103 详情").click();

		const dialog = page.getByRole("dialog", { name: "操作日志详情" });
		await expect(dialog).toBeVisible();

		// Parse-failure annotation visible
		await expect(dialog.getByText("(原始文本，非 JSON)")).toBeVisible();

		// Raw payload preserved verbatim
		const pre = dialog.getByTestId("admin-log-details");
		await expect(pre).toContainText("legacy plain text payload, not json");
	});
});

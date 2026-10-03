import { expect, test } from "../../admin/fixtures/admin-base";

const users = Array.from({ length: 20 }, (_, index) => ({
	id: index + 1,
	username: `scroll-user-${index + 1}`,
	email: `scroll-user-${index + 1}@example.test`,
	role: 0,
	status: 1,
	threads: 10,
	posts: 20,
	credits: 100,
	coins: 50,
	regDate: 1_700_000_000,
	lastLogin: 1_700_000_000,
}));

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 1280, height: 600 },
	{ width: 375, height: 812 },
]) {
	for (const path of ["/admin/recent", "/admin/users", "/admin/analytics?tab=login"]) {
		test(`keeps ${path} on one vertical scroll at ${viewport.width}x${viewport.height}`, async ({
			page,
			loginAsAdmin,
		}) => {
			await page.setViewportSize(viewport);
			await page.route("**/api/admin/**", (route) => {
				if (route.request().method() !== "GET") return route.abort();
				const url = new URL(route.request().url());
				if (url.pathname === "/api/admin/users") {
					return route.fulfill({
						json: { data: users, meta: { page: 1, pages: 2, limit: 20, total: 40 } },
					});
				}
				if (url.pathname.endsWith("/today/logins/list")) {
					return route.fulfill({
						json: {
							data: {
								page: 1,
								limit: 20,
								total: 40,
								rows: users.map((user) => ({
									id: user.id,
									userId: user.id,
									username: user.username,
									ok: 1,
									kind: "login",
									errorCode: "",
									ip: "192.0.2.1",
									userAgent: "Scroll regression browser",
									botClass: "human",
									createdAt: user.lastLogin,
								})),
							},
						},
					});
				}
				return route.fulfill({ json: { data: {} } });
			});
			await loginAsAdmin();
			await page.goto(path);
			const table = page.getByRole("table");
			await expect(table.locator("tbody tr")).toHaveCount(20);
			const region = table.locator("..");
			const island = page.locator("main [data-basalt-surface-root]").first();
			expect(
				await region.evaluate((element) => element.scrollHeight - element.clientHeight),
			).toBeLessThanOrEqual(1);
			await table.locator("tbody tr").first().hover();
			await page.mouse.wheel(0, 100_000);
			await expect
				.poll(() =>
					island.evaluate(
						(element) => element.scrollHeight - element.clientHeight - element.scrollTop,
					),
				)
				.toBeLessThanOrEqual(2);
			await expect(table.locator("tbody tr").last()).toBeInViewport();
			await expect(page.getByRole("button", { name: /^(下一页|Next page)$/ })).toBeInViewport();
			if (viewport.width < 768) {
				await region.evaluate((element) => {
					element.scrollLeft = element.scrollWidth;
				});
				expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
				await expect(table.locator("tbody tr").last().locator("td").last()).toBeInViewport();
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				viewport.width,
			);
		});
	}

	test(`keeps cache detail on one vertical scroll at ${viewport.width}x${viewport.height}`, async ({
		page,
		loginAsAdmin,
	}) => {
		await page.setViewportSize(viewport);
		await page.route("**/api/admin/kv/**", (route) => {
			if (route.request().method() !== "GET") return route.abort();
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith("/overview")) {
				return route.fulfill({
					json: {
						data: {
							families: [
								{
									family: "settings:all",
									displayName: "Settings cache",
									category: "cache",
									status: "shipped",
									pattern: "settings:all",
									ttl: 86400,
									nameSensitivity: "public",
									valueSensitivity: "public",
									count: 1,
									presence: "present",
									sampleKeys: [],
								},
							],
						},
					},
				});
			}
			if (path.endsWith("/inspect")) {
				return route.fulfill({
					json: {
						data: {
							family: "settings:all",
							key: "settings:all",
							rawKey: "settings:all",
							value: Object.fromEntries(users.map((user) => [user.username, user])),
							valueMasked: false,
							valid: true,
							status: "valid",
							scope: "public",
							params: {},
						},
					},
				});
			}
			return route.fulfill({
				json: {
					data: {
						family: "settings:all",
						keys: [{ key: "settings:all", rawKey: "settings:all", expiration: null }],
						cursor: null,
						listComplete: true,
					},
				},
			});
		});
		await loginAsAdmin();
		await page.goto("/admin/statistics/kv");
		await page.getByRole("button", { name: "展开Settings cache" }).click();
		await page.getByRole("button", { name: "查看", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "settings:all", exact: true });
		const preview = dialog.locator("pre");
		await expect(preview).toContainText("scroll-user-20");
		expect(
			await preview.evaluate((element) => element.scrollHeight - element.clientHeight),
		).toBeLessThanOrEqual(1);
		await preview.hover({ position: { x: 10, y: 10 } });
		await page.mouse.wheel(0, 100_000);
		const body = dialog.locator(".overflow-y-auto");
		await expect
			.poll(() =>
				body.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
			)
			.toBeLessThanOrEqual(2);
		await expect(preview.getByText('"scroll-user-20"', { exact: true }).first()).toBeInViewport();
		await expect(dialog.getByRole("button", { name: "关闭弹窗" })).toBeInViewport();
	});
}

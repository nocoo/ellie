import { expect, test } from "../../admin/fixtures/admin-base";

test.describe("Admin Basalt integration", () => {
	test("keeps the brand stationary and navigation links usable when collapsing", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await loginAsAdmin();
		await page.goto("/admin");
		const logo = page.getByRole("complementary").getByRole("img", { name: "Ellie" });
		const before = await logo.boundingBox();
		await page.getByRole("button", { name: "收起侧栏" }).click();
		await expect(page.getByRole("complementary")).toHaveCSS("width", "68px");
		const after = await logo.boundingBox();
		expect(after?.x).toBe(before?.x);
		expect(after?.y).toBe(before?.y);
		const users = page
			.getByRole("navigation", { name: "管理后台", exact: true })
			.getByRole("link", { name: "用户", exact: true });
		await expect(users).toHaveAttribute("href", "/admin/users");
		await users.click();
		await expect(page).toHaveURL(/\/admin\/users$/);
		await expect(users).toHaveAttribute("aria-current", "page");
		await page.getByRole("button", { name: "展开侧栏" }).click();
		await expect(page.getByRole("complementary")).toHaveCSS("width", "260px");
		expect((await logo.boundingBox())?.x).toBe(before?.x);
	});

	test("traps mobile navigation focus and restores the trigger on dismissal", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin();
		await page.goto("/admin");
		const trigger = page.getByRole("button", { name: "打开导航" });
		await expect(page.getByRole("complementary")).toHaveCount(0);
		await trigger.click();
		const drawer = page.getByRole("dialog", { name: "管理后台导航" });
		await expect(drawer).toBeVisible();
		await page.keyboard.press("Shift+Tab");
		expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await drawer.getByRole("link", { name: "用户", exact: true }).click();
		await expect(page).toHaveURL(/\/admin\/users$/);
		await expect(drawer).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			375,
		);
	});

	test("preserves the Google server-action form, login errors and theme preference", async ({
		page,
	}) => {
		await page.goto("/login?error=AccessDenied");
		await expect(page.getByRole("alert")).toHaveText("您的账号无权访问此应用。");
		const signIn = page.getByRole("button", { name: "使用 Google 登录" });
		await expect(signIn).toHaveAttribute("type", "submit");
		await expect(signIn).toBeEnabled();
		await expect(signIn.locator("..")).toHaveAttribute("method", "POST");
		await page.evaluate(() => localStorage.setItem("theme", "light"));
		await page.reload();
		await page.getByRole("button", { name: "切换主题" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
		await page.getByRole("button", { name: "切换主题" }).click();
		expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("system");
	});

	test("keeps keyboard tabs in the URL and clears login filters", async ({
		page,
		loginAsAdmin,
	}) => {
		const requests: URL[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (url.pathname.endsWith("/today/logins/list")) requests.push(url);
		});
		await loginAsAdmin();
		await page.goto("/admin/analytics?tab=audit&foo=bar");
		await page.getByRole("tab", { name: "审计", exact: true }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(page).toHaveURL(/tab=login/);
		expect(new URL(page.url()).searchParams.get("foo")).toBe("bar");
		await page.reload();
		await expect(page.getByRole("tab", { name: "登录", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		const result = page.getByRole("radiogroup", { name: "结果", exact: true });
		const kind = page.getByRole("radiogroup", { name: "操作类型", exact: true });
		await result.getByRole("radio", { name: "失败", exact: true }).click();
		await expect.poll(() => requests.at(-1)?.searchParams.get("ok")).toBe("0");
		await kind.getByRole("radio", { name: "注册", exact: true }).click();
		await expect.poll(() => requests.at(-1)?.searchParams.get("kind")).toBe("register");
		await result.getByRole("radio", { name: "全部", exact: true }).click();
		await expect.poll(() => requests.at(-1)?.searchParams.has("ok")).toBe(false);
		await kind.getByRole("radio", { name: "登录+注册", exact: true }).click();
		await expect.poll(() => requests.at(-1)?.searchParams.has("kind")).toBe(false);
		expect(requests.some((url) => url.search.includes("__empty__"))).toBe(false);
	});

	test("previews attachments with navigation, bounded zoom and restored dialog focus", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.route("**/api/admin/attachments**", (route) =>
			route.fulfill({
				json: {
					data: [1, 2].map((id) => ({
						id,
						postId: 1,
						filename: `preview-${id}.svg`,
						filePath: `/basalt-preview-${id}.svg`,
						fileSize: 1024,
						isImage: true,
						hasThumb: false,
						downloads: 0,
						authorId: 1,
						threadId: 662174,
						createdAt: 1_700_000_000,
					})),
					meta: { page: 1, pages: 1, limit: 20, total: 2 },
				},
			}),
		);
		await page.route("https://t.no.mt/basalt-preview-*.svg", (route) =>
			route.fulfill({
				contentType: "image/svg+xml",
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#38b2ac"/></svg>',
			}),
		);
		await loginAsAdmin();
		await page.goto("/admin/attachments");
		const trigger = page.getByRole("button", { name: "预览 preview-1.svg", exact: true });
		await trigger.click();
		const viewer = page.getByRole("dialog", { name: "图片预览", exact: true });
		await expect(viewer).toBeVisible();
		await expect(viewer.getByRole("status", { name: "加载图片" })).toBeHidden();
		await expect(viewer.getByLabel("缩放比例")).toHaveText("100%");
		await page.keyboard.press("ArrowLeft");
		await expect(viewer.getByRole("img", { name: "preview-2.svg", exact: true })).toBeVisible();
		await page.keyboard.press("ArrowRight");
		await expect(viewer.getByRole("img", { name: "preview-1.svg", exact: true })).toBeVisible();
		for (let i = 0; i < 8; i++) await page.keyboard.press("+");
		await expect(viewer.getByLabel("缩放比例")).toHaveText("400%");
		await expect(viewer.getByRole("button", { name: "放大图片" })).toBeDisabled();
		await viewer.getByRole("button", { name: "查看第 2 张图片" }).click();
		await expect(viewer.getByLabel("缩放比例")).toHaveText("100%");
		for (let i = 0; i < 3; i++) await page.keyboard.press("-");
		await expect(viewer.getByLabel("缩放比例")).toHaveText("50%");
		await expect(viewer.getByRole("button", { name: "缩小图片" })).toBeDisabled();
		await expect(viewer.getByRole("link", { name: "下载图片" })).toHaveAttribute(
			"href",
			"https://t.no.mt/basalt-preview-2.svg",
		);
		await expect(viewer.getByRole("link", { name: "下载图片" })).toHaveAttribute(
			"download",
			"preview-2.svg",
		);
		await page.keyboard.press("Escape");
		await expect(viewer).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await expect(viewer.getByLabel("缩放比例")).toHaveText("100%");
		await expect(viewer.getByRole("img", { name: "preview-1.svg", exact: true })).toBeVisible();
		await viewer.getByRole("button", { name: "关闭图片预览" }).click();
		await expect(trigger).toBeFocused();

		const menuTrigger = page.getByRole("button", { name: "打开「preview-1.svg」操作菜单" });
		await menuTrigger.click();
		await page.getByRole("menuitem", { name: "删除", exact: true }).click();
		await expect(page.getByRole("dialog", { name: "删除附件", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menuTrigger).toBeFocused();
	});

	test("keeps filters, table rows, batch actions and breadcrumb links usable on narrow screens", async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin();
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto("/admin/threads");
		const filters = page.getByRole("group", { name: "筛选", exact: true });
		const selects = filters.getByRole("combobox");
		await expect(selects).toHaveCount(5);
		for (const select of await selects.all()) {
			expect((await select.boundingBox())?.width).toBeLessThan(300);
		}

		for (const width of [320, 375]) {
			await page.setViewportSize({ width, height: 812 });
			await page.goto("/admin/users");
			const table = page.getByRole("table");
			await expect(table).toBeVisible();
			expect((await table.locator("tbody tr").first().boundingBox())?.height).toBeLessThan(100);
			expect(
				await table.evaluate(
					(element) => element.scrollWidth > (element.parentElement?.clientWidth ?? 0),
				),
			).toBe(true);
			await page
				.getByRole("checkbox", { name: /^选择行 / })
				.first()
				.click();
			const batch = page.getByRole("region", { name: "批量操作" });
			await expect(batch).toBeVisible();
			for (const button of await batch.getByRole("button").all()) {
				const box = await button.boundingBox();
				if (!box) throw new Error("Expected a visible batch action");
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
			}
			await batch.getByRole("button", { name: "清除选择" }).click();
			await expect(batch).toBeHidden();
			await page.goto("/admin/statistics/kv");
			const trail = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
			await expect(trail.getByRole("link", { name: "数据统计" })).toHaveCount(0);
			await expect(trail.getByText("数据统计", { exact: true })).toBeVisible();
			const dashboard = trail.getByRole("link", { name: "仪表盘", exact: true });
			expect((await dashboard.boundingBox())?.height).toBeLessThan(25);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			await dashboard.click();
			await expect(page).toHaveURL(/\/admin$/);
		}
		await page.goto("/admin/users/3");
		const trail = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
		await trail.getByRole("link", { name: "用户", exact: true }).click();
		await expect(page).toHaveURL(/\/admin\/users$/);
	});

	test("keeps every attachment pagination control reachable on narrow screens", async ({
		page,
		loginAsAdmin,
	}) => {
		await page.route("**/api/admin/attachments**", (route) => {
			const currentPage = Number(new URL(route.request().url()).searchParams.get("page") ?? 1);
			return route.fulfill({
				json: {
					data: [
						{
							id: currentPage,
							postId: 1,
							filename: "paginated.pdf",
							filePath: "/paginated.pdf",
							fileSize: 1024,
							isImage: false,
							hasThumb: false,
							downloads: 0,
							authorId: 1,
							threadId: 662174,
							createdAt: 1_700_000_000,
						},
					],
					meta: { page: currentPage, pages: 10, limit: 20, total: 200 },
				},
			});
		});
		await loginAsAdmin();
		for (const width of [320, 375]) {
			await page.setViewportSize({ width, height: 812 });
			await page.goto("/admin/attachments");
			await page.getByRole("button", { name: "末页", exact: true }).click();
			await expect(page.getByRole("button", { name: "第 10 页" })).toHaveAttribute(
				"aria-current",
				"page",
			);
			await page.getByRole("button", { name: "第 8 页" }).click();
			await expect(page.getByRole("button", { name: "第 8 页" })).toHaveAttribute(
				"aria-current",
				"page",
			);
			const controls = page.getByRole("button", { name: /^(首页|上一页|第 \d+ 页|下一页|末页)$/ });
			await expect(controls).toHaveCount(9);
			for (const control of await controls.all()) {
				await control.scrollIntoViewIfNeeded();
				const box = await control.boundingBox();
				if (!box) throw new Error("Expected a visible pagination control");
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
				await control.click({ trial: true });
			}
			await page.getByRole("button", { name: "上一页", exact: true }).click();
			await expect(page.getByRole("button", { name: "第 7 页" })).toHaveAttribute(
				"aria-current",
				"page",
			);
			await page.getByRole("button", { name: "首页", exact: true }).click();
			await expect(page.getByRole("button", { name: "第 1 页" })).toHaveAttribute(
				"aria-current",
				"page",
			);
			await page.getByRole("button", { name: "下一页", exact: true }).click();
			await expect(page.getByRole("button", { name: "第 2 页" })).toHaveAttribute(
				"aria-current",
				"page",
			);
		}
	});

	test("wraps long thread titles without obscuring page actions", async ({
		page,
		loginAsAdmin,
	}) => {
		const subject = "A".repeat(85);
		await page.route("**/api/admin/threads/662174", async (route) => {
			const response = await route.fetch();
			const json = await response.json();
			await route.fulfill({ response, json: { ...json, data: { ...json.data, subject } } });
		});
		await loginAsAdmin();
		for (const width of [320, 375, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/admin/threads/662174");
			const content = page.locator("main [data-basalt-surface-root]");
			const header = content.locator("header", { hasText: subject });
			const title = header.getByRole("heading", { name: subject, exact: true, level: 1 });
			await expect(title).toBeVisible();
			expect(await title.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
				await title.evaluate((element) => element.clientWidth),
			);
			expect(await content.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
				await content.evaluate((element) => element.clientWidth),
			);
			await header.getByRole("button", { name: "删除", exact: true }).click({ trial: true });
			await header.getByRole("button", { name: "编辑", exact: true }).click();
			await expect(page.getByRole("dialog", { name: "编辑主题", exact: true })).toBeVisible();
			await page.keyboard.press("Escape");
		}
	});

	test("raises nested surfaces in both themes and restores focus through nested dialogs", async ({
		page,
		loginAsAdmin,
	}) => {
		await loginAsAdmin();
		await page.goto("/admin/users/3");
		for (const mode of ["light", "dark"]) {
			await page.evaluate((theme) => localStorage.setItem("theme", theme), mode);
			await page.reload();
			await expect(page.getByRole("button", { name: "编辑资料" })).toBeVisible();
			const colors = await page.locator("main [data-basalt-surface-root]").evaluate((root) => {
				const card = root.querySelector("[data-basalt-surface]");
				const well = card?.querySelector("[data-basalt-surface]");
				if (!card || !well) throw new Error("Expected a structured detail card");
				return [root, card, well].map((node) => {
					const color = getComputedStyle(node).backgroundColor;
					return { color, channel: Number(color.match(/[\d.]+/)?.[0]) };
				});
			});
			expect(colors.map(({ color }) => color)).not.toContain("rgba(0, 0, 0, 0)");
			expect(colors[0].channel).toBeLessThan(colors[1].channel);
			expect(colors[1].channel).toBeLessThan(colors[2].channel);
		}
		await page.goto("/admin/users?search=testuser");
		const trigger = page.getByRole("button", { name: "查看用户「testuser」详情" });
		await trigger.click();
		const detail = page.getByRole("dialog", { name: "用户详情", exact: true });
		const edit = detail.getByRole("button", { name: "编辑资料" });
		await edit.click();
		const editor = page.getByRole("dialog", { name: "编辑用户", exact: true });
		await expect(editor).toBeVisible();
		await expect(editor).toHaveCSS("opacity", "1");
		await expect(editor).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await page.keyboard.press("Escape");
		await expect(editor).toBeHidden();
		await expect(detail).toBeVisible();
		await expect(edit).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(detail).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("renders responsive charts with named keyboard tooltips and independent gradients", async ({
		page,
		loginAsAdmin,
	}) => {
		const series = [1, 2, 3].map((count) => ({ date: `2026-09-${13 + count}`, count }));
		await page.route("**/api/admin/analytics/trend?**", (route) =>
			route.fulfill({ json: { data: { metric: "users", range: "7d", series } } }),
		);
		await page.route("**/api/admin/analytics/checkin?**", (route) =>
			route.fulfill({ json: { data: { range: "7d", series } } }),
		);
		await page.route("**/api/admin/analytics/forum-dist?**", (route) =>
			route.fulfill({
				json: {
					data: {
						range: "7d",
						rows: Array.from({ length: 14 }, (_, i) => ({
							forumId: i + 1,
							forumName: `版块 ${i + 1}`,
							posts: 20 - i,
						})),
					},
				},
			}),
		);
		await loginAsAdmin();
		await page.goto("/admin/analytics");
		const trend = page.getByRole("group", { name: "新注册趋势", exact: true });
		const plot = trend.locator("svg.recharts-surface");
		await expect(plot).toBeVisible();
		await plot.focus();
		await page.keyboard.press("ArrowRight");
		await expect(trend.getByTestId("chart-tooltip")).toBeVisible();
		await expect(trend.getByTestId("chart-tooltip")).toContainText("新注册");
		await expect(trend.getByTestId("chart-tooltip")).toContainText("2026-09-");
		const distribution = page.getByRole("group", { name: "版块回复数分布", exact: true });
		await expect(distribution.locator(".recharts-bar-rectangle")).toHaveCount(12);
		const gradientIds = await page
			.locator("svg.recharts-surface linearGradient")
			.evaluateAll((nodes) => nodes.map((node) => node.id));
		expect(gradientIds).toHaveLength(2);
		expect(new Set(gradientIds).size).toBe(2);
	});
});

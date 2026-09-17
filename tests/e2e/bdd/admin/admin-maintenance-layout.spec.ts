import { expect, test } from "../../admin/fixtures/admin-base";

for (const width of [320, 375]) {
	test(`keeps maintenance table values and controls reachable at ${width}px`, async ({
		page,
		loginAsAdmin,
	}) => {
		await page.setViewportSize({ width, height: 812 });
		let mutations = 0;
		const metricsObservedAt = Date.parse("2026-09-16T12:00:00Z");
		await page.route("**/api/admin/**", (route) => {
			if (route.request().method() !== "GET") {
				mutations++;
				return route.abort("blockedbyclient");
			}
			const path = new URL(route.request().url()).pathname;
			if (path === "/api/admin/stats/calibrate")
				return route.fulfill({
					json: {
						data: {
							counters: [{ key: "stats.total_threads", stored: 10, real: 12 }],
							todayPosts: 5,
							todayDate: "2026-09-16",
						},
					},
				});
			if (path === "/api/admin/kv/metrics")
				return route.fulfill({
					json: {
						ok: true,
						data: {
							family: null,
							minutes: 1440,
							observedAt: metricsObservedAt,
							source: "application:kv_cache_metrics_hour",
							intervalMinutes: 60,
							sampling: "best-effort",
							truncated: false,
							coverage: "complete",
							series: [
								{
									family: "thread:entity",
									tsMinute: metricsObservedAt / 60000,
									op: "error",
									count: 7,
								},
							],
						},
					},
				});
			return route.continue();
		});
		await loginAsAdmin();
		await page.goto("/admin/statistics/calibrate");
		const counters = page.getByRole("region", { name: "计数器比对表格" });
		const apply = page.getByRole("button", { name: "应用偏移", exact: true });
		await expect(counters.getByRole("cell", { name: "总主题数", exact: true })).toBeVisible();
		const before = await apply.boundingBox();
		await counters.focus();
		await page.keyboard.press("ArrowRight");
		await expect.poll(() => counters.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
		await counters.evaluate((element) => {
			element.scrollLeft = element.scrollWidth;
		});
		await expect(
			counters.getByRole("columnheader", { name: "最终值", exact: true }),
		).toBeInViewport();
		const offset = counters.getByRole("spinbutton", { name: "总主题数调整偏移", exact: true });
		await expect(offset).toBeInViewport();
		await offset.fill("7");
		await expect(counters.locator("tbody tr").first().getByRole("cell").last()).toHaveText("17");
		await expect(apply).toBeEnabled();
		expect((await apply.boundingBox())?.x).toBe(before?.x);
		await expect(apply).toBeInViewport();
		await expect(page.getByRole("button", { name: "同步真实值", exact: true })).toBeInViewport();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);

		await page.goto("/admin/statistics/kv");
		const overview = page.getByRole("region", { name: "KV 家族总览表格" });
		await expect(overview.getByRole("table")).toBeVisible();
		await overview.evaluate((element) => {
			element.scrollIntoView({ block: "start" });
			element.focus({ preventScroll: true });
		});
		await page.keyboard.press("ArrowRight");
		await expect.poll(() => overview.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
		await overview.evaluate((element) => {
			element.scrollLeft = element.scrollWidth;
		});
		await expect(
			overview.getByRole("columnheader", { name: "操作", exact: true }),
		).toBeInViewport();
		await expect(
			overview.getByRole("button", { name: "使一组缓存失效", exact: true }).first(),
		).toBeInViewport();
		await page.getByRole("tab", { name: "运行趋势", exact: true }).click();
		const legend = page.getByRole("list", { name: "缓存运行趋势图例", exact: true });
		await legend.scrollIntoViewIfNeeded();
		await expect(legend.getByText("回填/失效失败", { exact: true })).toBeInViewport();
		const metrics = page.getByRole("group", { name: "缓存运行趋势", exact: true });
		await metrics.scrollIntoViewIfNeeded();
		await expect(metrics).toBeInViewport();
		await metrics.getByRole("application", { name: "缓存运行趋势", exact: true }).focus();
		await page.keyboard.press("ArrowRight");
		const tooltip = metrics.getByTestId("chart-tooltip");
		await expect(tooltip).toBeVisible();
		await expect(tooltip.getByText("回填/失效失败（次）", { exact: true })).toBeInViewport();
		await expect(tooltip.getByText("7", { exact: true })).toBeInViewport();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
		expect(mutations).toBe(0);
	});
}

import { describe, expect, it } from "bun:test";
import {
	NAV_GROUPS,
	ROUTE_LABELS,
	breadcrumbsFromPathname,
} from "../../../apps/web/src/lib/navigation";

describe("NAV_GROUPS", () => {
	it("has 5 groups", () => {
		expect(NAV_GROUPS.length).toBe(5);
		expect(NAV_GROUPS.map((g) => g.label)).toEqual([
			"概览",
			"内容管理",
			"数据统计",
			"安全管理",
			"设置",
		]);
	});

	it("has 13 total nav items", () => {
		const total = NAV_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
		expect(total).toBe(13);
	});

	it("each group has items with required fields", () => {
		for (const group of NAV_GROUPS) {
			expect(group.label).toBeTruthy();
			expect(group.items.length).toBeGreaterThan(0);
			for (const item of group.items) {
				expect(item.href).toBeTruthy();
				expect(item.label).toBeTruthy();
				expect(item.icon).toBeTruthy();
			}
		}
	});

	it("dashboard is in the first group", () => {
		const firstGroup = NAV_GROUPS[0];
		const dashboard = firstGroup?.items.find((i) => i.href === "/admin");
		expect(dashboard).toBeTruthy();
		expect(dashboard?.label).toBe("仪表盘");
	});

	it("content management group has correct items", () => {
		const contentGroup = NAV_GROUPS.find((g) => g.label === "内容管理");
		expect(contentGroup).toBeTruthy();
		const labels = contentGroup?.items.map((i) => i.label);
		expect(labels).toEqual(["用户", "主题", "版块", "附件"]);
	});

	it("statistics group has correct items", () => {
		const statsGroup = NAV_GROUPS.find((g) => g.label === "数据统计");
		expect(statsGroup).toBeTruthy();
		const labels = statsGroup?.items.map((i) => i.label);
		expect(labels).toEqual(["统计计算"]);
	});

	it("security group has correct items", () => {
		const securityGroup = NAV_GROUPS.find((g) => g.label === "安全管理");
		expect(securityGroup).toBeTruthy();
		const labels = securityGroup?.items.map((i) => i.label);
		expect(labels).toEqual(["举报管理", "IP 封禁", "敏感词"]);
	});

	it("settings group has general settings, feature settings, nav links, and friend links", () => {
		const settingsGroup = NAV_GROUPS.find((g) => g.label === "设置");
		expect(settingsGroup).toBeTruthy();
		const labels = settingsGroup?.items.map((i) => i.label);
		expect(labels).toEqual(["通用设置", "功能设置", "顶部导航", "友情链接"]);
		expect(settingsGroup?.items[0]?.icon).toBe("Settings");
		expect(settingsGroup?.items[1]?.icon).toBe("ToggleLeft");
	});

	it("first four groups default to open, settings group does not", () => {
		expect(NAV_GROUPS[0]?.defaultOpen).toBe(true);
		expect(NAV_GROUPS[1]?.defaultOpen).toBe(true);
		expect(NAV_GROUPS[2]?.defaultOpen).toBe(true);
		expect(NAV_GROUPS[3]?.defaultOpen).toBe(true);
		// Settings group doesn't set defaultOpen
		expect(NAV_GROUPS[4]?.defaultOpen).toBeUndefined();
	});
});

describe("ROUTE_LABELS", () => {
	it("has label for admin", () => {
		expect(ROUTE_LABELS.admin).toBe("仪表盘");
	});

	it("has label for users", () => {
		expect(ROUTE_LABELS.users).toBe("用户");
	});

	it("has labels for all entity routes", () => {
		expect(ROUTE_LABELS.threads).toBe("主题");
		expect(ROUTE_LABELS.posts).toBe("回复");
		expect(ROUTE_LABELS.forums).toBe("版块");
		expect(ROUTE_LABELS.attachments).toBe("附件");
		expect(ROUTE_LABELS["ip-bans"]).toBe("IP 封禁");
		expect(ROUTE_LABELS["censor-words"]).toBe("敏感词");
		expect(ROUTE_LABELS.settings).toBe("设置");
		expect(ROUTE_LABELS.general).toBe("通用设置");
	});

	it("does not have legacy content label", () => {
		expect(ROUTE_LABELS.content).toBeUndefined();
	});
});

describe("breadcrumbsFromPathname", () => {
	it("returns home for /admin", () => {
		const items = breadcrumbsFromPathname("/admin");
		expect(items).toEqual([{ label: "首页", href: "/admin" }, { label: "仪表盘" }]);
	});

	it("returns breadcrumb trail for /admin/users", () => {
		const items = breadcrumbsFromPathname("/admin/users");
		expect(items).toEqual([
			{ label: "首页", href: "/admin" },
			{ label: "仪表盘" }, // admin is non-navigable
			{ label: "用户" },
		]);
	});

	it("returns breadcrumb trail for /admin/threads", () => {
		const items = breadcrumbsFromPathname("/admin/threads");
		expect(items).toEqual([
			{ label: "首页", href: "/admin" },
			{ label: "仪表盘" },
			{ label: "主题" },
		]);
	});

	it("returns breadcrumb trail for /admin/ip-bans", () => {
		const items = breadcrumbsFromPathname("/admin/ip-bans");
		expect(items).toEqual([
			{ label: "首页", href: "/admin" },
			{ label: "仪表盘" },
			{ label: "IP 封禁" },
		]);
	});

	it("returns breadcrumb trail for /admin/censor-words", () => {
		const items = breadcrumbsFromPathname("/admin/censor-words");
		expect(items).toEqual([
			{ label: "首页", href: "/admin" },
			{ label: "仪表盘" },
			{ label: "敏感词" },
		]);
	});

	it("returns breadcrumb trail for /admin/settings/general", () => {
		const items = breadcrumbsFromPathname("/admin/settings/general");
		expect(items).toEqual([
			{ label: "首页", href: "/admin" },
			{ label: "仪表盘" },
			{ label: "设置", href: "/admin/settings" },
			{ label: "通用设置" },
		]);
	});

	it("falls back to truncated segment for unknown routes", () => {
		const items = breadcrumbsFromPathname("/admin/something-long");
		const last = items[items.length - 1];
		expect(last?.label).toBe("somethin");
	});
});

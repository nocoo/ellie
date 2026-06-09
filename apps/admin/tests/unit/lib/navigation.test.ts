import { describe, expect, it } from "vitest";
import {
	breadcrumbsFromPathname,
	isNavItemActive,
	NAV_GROUPS,
	ROUTE_LABELS,
} from "@/lib/navigation";

describe("navigation", () => {
	describe("NAV_GROUPS", () => {
		it("is a non-empty array of groups", () => {
			expect(NAV_GROUPS.length).toBeGreaterThan(0);
		});

		it("each group has label and items", () => {
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
	});

	describe("ROUTE_LABELS", () => {
		it("has admin entry", () => {
			expect(ROUTE_LABELS.admin).toBe("仪表盘");
		});

		it("has users entry", () => {
			expect(ROUTE_LABELS.users).toBe("用户");
		});
	});

	describe("breadcrumbsFromPathname", () => {
		it("returns 首页 for /admin", () => {
			const items = breadcrumbsFromPathname("/admin");
			expect(items[0]).toEqual({ label: "首页", href: "/admin" });
			// "admin" segment is non-navigable, no href
			expect(items[1]).toEqual({ label: "仪表盘" });
		});

		it("handles /admin/users", () => {
			const items = breadcrumbsFromPathname("/admin/users");
			expect(items).toHaveLength(3);
			expect(items[0]).toEqual({ label: "首页", href: "/admin" });
			expect(items[1]).toEqual({ label: "仪表盘" }); // admin is non-navigable
			expect(items[2]).toEqual({ label: "用户" }); // last segment, no href
		});

		it("handles nested /admin/settings/general", () => {
			const items = breadcrumbsFromPathname("/admin/settings/general");
			expect(items).toHaveLength(4);
			expect(items[2]).toEqual({ label: "设置", href: "/admin/settings" });
			expect(items[3]).toEqual({ label: "通用设置" });
		});

		it("truncates unknown segments to 8 chars", () => {
			const items = breadcrumbsFromPathname("/admin/verylongsegmentname");
			expect(items[2].label).toBe("verylong");
		});

		it("renders statistics segment as non-navigable group label", () => {
			// `statistics` is now a grouping segment (the actual page lives at
			// `/admin/statistics/recalc`). Breadcrumb should show 数据统计 as
			// plain text with no href, not as a clickable link to a redirect.
			const items = breadcrumbsFromPathname("/admin/statistics/kv");
			expect(items).toHaveLength(4);
			expect(items[2]).toEqual({ label: "数据统计" });
			expect(items[3]).toEqual({ label: "KV 缓存监控" });
		});
	});

	describe("isNavItemActive", () => {
		it("matches exact pathname", () => {
			expect(isNavItemActive("/admin/users", "/admin/users")).toBe(true);
		});

		it("matches nested child path", () => {
			expect(isNavItemActive("/admin/users/42", "/admin/users")).toBe(true);
		});

		it("matches nested child path via separator-aware prefix", () => {
			// Nested children DO highlight a parent nav item — that's the
			// intended behavior for entries like `/admin/users` matching
			// `/admin/users/42`. The double-highlight bug was fixed by
			// removing the colliding parent nav entry from NAV_GROUPS, not
			// by tightening this helper. See NAV_GROUPS test below.
			expect(isNavItemActive("/admin/statistics/kv", "/admin/statistics")).toBe(true);
		});

		it("does not match unrelated path with shared word prefix", () => {
			// `/admin/foo-bar` must NOT match `/admin/foo` (no `/` separator).
			expect(isNavItemActive("/admin/foo-bar", "/admin/foo")).toBe(false);
		});

		it("matches recalc only on its own path", () => {
			expect(isNavItemActive("/admin/statistics/recalc", "/admin/statistics/recalc")).toBe(true);
			expect(isNavItemActive("/admin/statistics/kv", "/admin/statistics/recalc")).toBe(false);
		});

		it("/admin stays exact-match (does not highlight on every admin page)", () => {
			expect(isNavItemActive("/admin", "/admin")).toBe(true);
			expect(isNavItemActive("/admin/users", "/admin")).toBe(false);
		});
	});

	describe("NAV_GROUPS — statistics group routes", () => {
		it("statistics group uses /admin/statistics/recalc as the recalc href", () => {
			const stats = NAV_GROUPS.find((g) => g.label === "数据统计");
			expect(stats).toBeDefined();
			const recalc = stats?.items.find((i) => i.label === "统计计算");
			expect(recalc?.href).toBe("/admin/statistics/recalc");
		});

		it("recalc and kv hrefs do not collide via prefix match", () => {
			const stats = NAV_GROUPS.find((g) => g.label === "数据统计");
			const recalcHref = stats?.items.find((i) => i.label === "统计计算")?.href;
			const kvHref = stats?.items.find((i) => i.label === "KV 缓存监控")?.href;
			expect(recalcHref).toBeDefined();
			expect(kvHref).toBeDefined();
			// Neither path is a `${other}/...` prefix of the other.
			expect(isNavItemActive(kvHref ?? "", recalcHref ?? "")).toBe(false);
			expect(isNavItemActive(recalcHref ?? "", kvHref ?? "")).toBe(false);
		});
	});
});

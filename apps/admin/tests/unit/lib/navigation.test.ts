import { NAV_GROUPS, ROUTE_LABELS, breadcrumbsFromPathname } from "@/lib/navigation";
import { describe, expect, it } from "vitest";

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
	});
});

import { describe, expect, it } from "bun:test";
import {
	NAV_GROUPS,
	ROUTE_LABELS,
	breadcrumbsFromPathname,
} from "../../../apps/web/src/lib/navigation";

describe("NAV_GROUPS", () => {
	it("has at least one group", () => {
		expect(NAV_GROUPS.length).toBeGreaterThan(0);
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
		expect(dashboard?.label).toBe("Dashboard");
	});
});

describe("ROUTE_LABELS", () => {
	it("has label for admin", () => {
		expect(ROUTE_LABELS.admin).toBe("Dashboard");
	});

	it("has label for users", () => {
		expect(ROUTE_LABELS.users).toBe("Users");
	});
});

describe("breadcrumbsFromPathname", () => {
	it("returns Home for /admin", () => {
		const items = breadcrumbsFromPathname("/admin");
		expect(items).toEqual([{ label: "Home", href: "/admin" }, { label: "Dashboard" }]);
	});

	it("returns breadcrumb trail for /admin/users", () => {
		const items = breadcrumbsFromPathname("/admin/users");
		expect(items).toEqual([
			{ label: "Home", href: "/admin" },
			{ label: "Dashboard" }, // admin is non-navigable
			{ label: "Users" },
		]);
	});

	it("returns breadcrumb trail for /admin/content", () => {
		const items = breadcrumbsFromPathname("/admin/content");
		expect(items).toEqual([
			{ label: "Home", href: "/admin" },
			{ label: "Dashboard" },
			{ label: "Content" },
		]);
	});

	it("falls back to truncated segment for unknown routes", () => {
		const items = breadcrumbsFromPathname("/admin/something-long");
		const last = items[items.length - 1];
		expect(last?.label).toBe("somethin");
	});
});

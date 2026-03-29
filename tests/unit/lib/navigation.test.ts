import { describe, expect, it } from "bun:test";
import {
	NAV_GROUPS,
	ROUTE_LABELS,
	breadcrumbsFromPathname,
} from "../../../apps/web/src/lib/navigation";

describe("NAV_GROUPS", () => {
	it("has 3 groups: Overview, Content Management, Security", () => {
		expect(NAV_GROUPS.length).toBe(3);
		expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Overview", "Content Management", "Security"]);
	});

	it("has 7 total nav items", () => {
		const total = NAV_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
		expect(total).toBe(7);
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

	it("Content Management has Users, Threads, Forums, Attachments", () => {
		const contentGroup = NAV_GROUPS.find((g) => g.label === "Content Management");
		expect(contentGroup).toBeTruthy();
		const labels = contentGroup?.items.map((i) => i.label);
		expect(labels).toEqual(["Users", "Threads", "Forums", "Attachments"]);
	});

	it("Security has IP Bans, Censor Words", () => {
		const securityGroup = NAV_GROUPS.find((g) => g.label === "Security");
		expect(securityGroup).toBeTruthy();
		const labels = securityGroup?.items.map((i) => i.label);
		expect(labels).toEqual(["IP Bans", "Censor Words"]);
	});

	it("all groups default to open", () => {
		for (const group of NAV_GROUPS) {
			expect(group.defaultOpen).toBe(true);
		}
	});
});

describe("ROUTE_LABELS", () => {
	it("has label for admin", () => {
		expect(ROUTE_LABELS.admin).toBe("Dashboard");
	});

	it("has label for users", () => {
		expect(ROUTE_LABELS.users).toBe("Users");
	});

	it("has labels for all entity routes", () => {
		expect(ROUTE_LABELS.threads).toBe("Threads");
		expect(ROUTE_LABELS.posts).toBe("Posts");
		expect(ROUTE_LABELS.forums).toBe("Forums");
		expect(ROUTE_LABELS.attachments).toBe("Attachments");
		expect(ROUTE_LABELS["ip-bans"]).toBe("IP Bans");
		expect(ROUTE_LABELS["censor-words"]).toBe("Censor Words");
	});

	it("does not have legacy content label", () => {
		expect(ROUTE_LABELS.content).toBeUndefined();
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

	it("returns breadcrumb trail for /admin/threads", () => {
		const items = breadcrumbsFromPathname("/admin/threads");
		expect(items).toEqual([
			{ label: "Home", href: "/admin" },
			{ label: "Dashboard" },
			{ label: "Threads" },
		]);
	});

	it("returns breadcrumb trail for /admin/ip-bans", () => {
		const items = breadcrumbsFromPathname("/admin/ip-bans");
		expect(items).toEqual([
			{ label: "Home", href: "/admin" },
			{ label: "Dashboard" },
			{ label: "IP Bans" },
		]);
	});

	it("returns breadcrumb trail for /admin/censor-words", () => {
		const items = breadcrumbsFromPathname("/admin/censor-words");
		expect(items).toEqual([
			{ label: "Home", href: "/admin" },
			{ label: "Dashboard" },
			{ label: "Censor Words" },
		]);
	});

	it("falls back to truncated segment for unknown routes", () => {
		const items = breadcrumbsFromPathname("/admin/something-long");
		const last = items[items.length - 1];
		expect(last?.label).toBe("somethin");
	});
});

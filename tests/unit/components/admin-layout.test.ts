import { describe, expect, test } from "bun:test";
import { NAV_ITEMS } from "@/components/layout/admin-sidebar";

describe("AdminSidebar", () => {
	describe("NAV_ITEMS", () => {
		test("has 5 navigation items", () => {
			expect(NAV_ITEMS).toHaveLength(5);
		});

		test("includes dashboard route", () => {
			const dashboard = NAV_ITEMS.find((item) => item.href === "/admin");
			expect(dashboard).toBeDefined();
			expect(dashboard?.label).toBe("Dashboard");
		});

		test("includes users route", () => {
			const users = NAV_ITEMS.find((item) => item.href === "/admin/users");
			expect(users).toBeDefined();
			expect(users?.label).toBe("Users");
		});

		test("includes content route", () => {
			const content = NAV_ITEMS.find((item) => item.href === "/admin/content");
			expect(content).toBeDefined();
			expect(content?.label).toBe("Content");
		});

		test("includes forums route", () => {
			const forums = NAV_ITEMS.find((item) => item.href === "/admin/forums");
			expect(forums).toBeDefined();
			expect(forums?.label).toBe("Forums");
		});

		test("includes settings route", () => {
			const settings = NAV_ITEMS.find((item) => item.href === "/admin/settings");
			expect(settings).toBeDefined();
			expect(settings?.label).toBe("Settings");
		});

		test("all items have icon component", () => {
			for (const item of NAV_ITEMS) {
				// Lucide icons are forwardRef objects with render function
				expect(item.icon).toBeDefined();
				expect(typeof item.icon === "function" || typeof item.icon === "object").toBe(true);
			}
		});

		test("all items have unique hrefs", () => {
			const hrefs = NAV_ITEMS.map((item) => item.href);
			const unique = new Set(hrefs);
			expect(unique.size).toBe(NAV_ITEMS.length);
		});

		test("all hrefs start with /admin", () => {
			for (const item of NAV_ITEMS) {
				expect(item.href.startsWith("/admin")).toBe(true);
			}
		});
	});
});

describe("AdminLayout", () => {
	test("exports AdminLayout function", async () => {
		const mod = await import("@/components/layout/admin-layout");
		expect(typeof mod.AdminLayout).toBe("function");
	});

	test("exports AdminSidebar function", async () => {
		const mod = await import("@/components/layout/admin-sidebar");
		expect(typeof mod.AdminSidebar).toBe("function");
	});
});

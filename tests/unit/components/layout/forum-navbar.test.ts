import { describe, expect, test } from "bun:test";
import { FORUM_NAV_ITEMS, isNavActive } from "@/components/layout/forum-navbar";

describe("ForumNavbar", () => {
	describe("FORUM_NAV_ITEMS", () => {
		test("exports non-empty nav items array", () => {
			expect(FORUM_NAV_ITEMS.length).toBeGreaterThan(0);
		});

		test("each item has required fields", () => {
			for (const item of FORUM_NAV_ITEMS) {
				expect(typeof item.href).toBe("string");
				expect(item.href.startsWith("/")).toBe(true);
				expect(typeof item.label).toBe("string");
				expect(item.label.length).toBeGreaterThan(0);
				expect(item.icon).toBeTruthy();
			}
		});

		test("includes Home, Digest, Search", () => {
			const labels = FORUM_NAV_ITEMS.map((i) => i.label);
			expect(labels).toContain("Home");
			expect(labels).toContain("Digest");
			expect(labels).toContain("Search");
		});

		test("Home item points to /", () => {
			const home = FORUM_NAV_ITEMS.find((i) => i.label === "Home");
			expect(home).toBeDefined();
			expect(home?.href).toBe("/");
		});

		test("no duplicate hrefs", () => {
			const hrefs = FORUM_NAV_ITEMS.map((i) => i.href);
			expect(new Set(hrefs).size).toBe(hrefs.length);
		});
	});

	describe("isNavActive", () => {
		test("Home (/) matches only exact /", () => {
			expect(isNavActive("/", "/")).toBe(true);
			expect(isNavActive("/", "/digest")).toBe(false);
			expect(isNavActive("/", "/forums/1")).toBe(false);
		});

		test("non-root paths match by prefix", () => {
			expect(isNavActive("/digest", "/digest")).toBe(true);
			expect(isNavActive("/digest", "/digest/page2")).toBe(true);
			expect(isNavActive("/search", "/search")).toBe(true);
			expect(isNavActive("/search", "/search?q=test")).toBe(true);
		});

		test("non-matching paths return false", () => {
			expect(isNavActive("/digest", "/")).toBe(false);
			expect(isNavActive("/digest", "/forums/1")).toBe(false);
			expect(isNavActive("/search", "/digest")).toBe(false);
		});
	});
});

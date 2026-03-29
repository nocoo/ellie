import { describe, expect, it } from "bun:test";
import {
	FORUM_NAV_ITEMS,
	FORUM_ROUTE_LABELS,
	forumBreadcrumbsFromPathname,
} from "../../../apps/web/src/lib/forum-navigation";

describe("FORUM_NAV_ITEMS", () => {
	it("has 3 nav items: 首页, 精华, 搜索", () => {
		expect(FORUM_NAV_ITEMS.length).toBe(3);
		expect(FORUM_NAV_ITEMS.map((i) => i.label)).toEqual(["首页", "精华", "搜索"]);
	});

	it("each item has required fields", () => {
		for (const item of FORUM_NAV_ITEMS) {
			expect(item.href).toBeTruthy();
			expect(item.label).toBeTruthy();
		}
	});

	it("homepage points to /", () => {
		const home = FORUM_NAV_ITEMS.find((i) => i.label === "首页");
		expect(home?.href).toBe("/");
	});

	it("digest points to /digest", () => {
		const digest = FORUM_NAV_ITEMS.find((i) => i.label === "精华");
		expect(digest?.href).toBe("/digest");
	});

	it("search points to /search", () => {
		const search = FORUM_NAV_ITEMS.find((i) => i.label === "搜索");
		expect(search?.href).toBe("/search");
	});
});

describe("FORUM_ROUTE_LABELS", () => {
	it("has label for forums", () => {
		expect(FORUM_ROUTE_LABELS.forums).toBe("版块");
	});

	it("has label for threads", () => {
		expect(FORUM_ROUTE_LABELS.threads).toBe("帖子");
	});

	it("has label for users", () => {
		expect(FORUM_ROUTE_LABELS.users).toBe("用户");
	});

	it("has label for digest", () => {
		expect(FORUM_ROUTE_LABELS.digest).toBe("精华");
	});

	it("has label for search", () => {
		expect(FORUM_ROUTE_LABELS.search).toBe("搜索");
	});

	it("does not have admin label", () => {
		expect(FORUM_ROUTE_LABELS.admin).toBeUndefined();
	});
});

describe("forumBreadcrumbsFromPathname", () => {
	it("returns only 首页 for root path /", () => {
		const items = forumBreadcrumbsFromPathname("/");
		expect(items).toEqual([{ label: "首页", href: "/" }]);
	});

	it("returns breadcrumb trail for /forums/42", () => {
		const items = forumBreadcrumbsFromPathname("/forums/42");
		expect(items).toEqual([
			{ label: "首页", href: "/" },
			{ label: "版块", href: "/forums" },
			{ label: "..." },
		]);
	});

	it("returns breadcrumb trail for /threads/123", () => {
		const items = forumBreadcrumbsFromPathname("/threads/123");
		expect(items).toEqual([
			{ label: "首页", href: "/" },
			{ label: "帖子", href: "/threads" },
			{ label: "..." },
		]);
	});

	it("returns breadcrumb trail for /users/5", () => {
		const items = forumBreadcrumbsFromPathname("/users/5");
		expect(items).toEqual([
			{ label: "首页", href: "/" },
			{ label: "用户", href: "/users" },
			{ label: "..." },
		]);
	});

	it("returns breadcrumb for /digest", () => {
		const items = forumBreadcrumbsFromPathname("/digest");
		expect(items).toEqual([{ label: "首页", href: "/" }, { label: "精华" }]);
	});

	it("returns breadcrumb for /search", () => {
		const items = forumBreadcrumbsFromPathname("/search");
		expect(items).toEqual([{ label: "首页", href: "/" }, { label: "搜索" }]);
	});

	it("falls back to raw segment for unknown routes", () => {
		const items = forumBreadcrumbsFromPathname("/unknown");
		expect(items).toEqual([{ label: "首页", href: "/" }, { label: "unknown" }]);
	});

	it("renders numeric segments as placeholder ...", () => {
		const items = forumBreadcrumbsFromPathname("/forums/99");
		const last = items[items.length - 1];
		expect(last?.label).toBe("...");
		expect(last?.href).toBeUndefined();
	});

	it("handles deeply nested paths", () => {
		const items = forumBreadcrumbsFromPathname("/threads/123/edit");
		expect(items.length).toBe(4);
		expect(items[0]).toEqual({ label: "首页", href: "/" });
		expect(items[1]).toEqual({ label: "帖子", href: "/threads" });
		expect(items[2]).toEqual({ label: "...", href: "/threads/123" });
		expect(items[3]).toEqual({ label: "edit" });
	});
});

import { describe, expect, it } from "bun:test";
import { FORUM_NAV_ITEMS } from "../../../apps/web/src/lib/forum-navigation";

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

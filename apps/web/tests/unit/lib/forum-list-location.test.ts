import { describe, expect, it } from "vitest";
import { forumListLocationFromUrl, parseForumListLocation } from "@/lib/forum-list-location";

describe("trusted forum list location", () => {
	it.each([
		["/forums/2", "2:1:0"],
		["/forums/2/3?page=9&typeId=4", "2:3:4"],
		["/forums/2?page=4&typeId=4&typeId=5", "2:4:0"],
		["/forums/2?page=3&page=4", "2:1:0"],
		["/forums/2?typeId=04", "2:1:0"],
		["/forums/2?typeId=9007199254740992", "2:1:0"],
		["/forums/2/new-thread", null],
		["/threads/2", null],
		["/forums/0", null],
		["/forums/2/9007199254740992", null],
	])("normalizes %s", (path, expected) => {
		expect(forumListLocationFromUrl(new URL(path, "https://local.test"))).toBe(expected);
	});
	it("rejects forged and unsafe header values", () => {
		for (const raw of [null, "", "1:0:0", "1:2:-1", "x:2:0", "1:2:0:1", "9007199254740992:1:0"])
			expect(parseForumListLocation(raw)).toBeNull();
		expect(parseForumListLocation("2:3:0")).toEqual({ forumId: 2, page: 3, typeId: null });
		expect(parseForumListLocation("2:3:4")).toEqual({ forumId: 2, page: 3, typeId: 4 });
	});
});

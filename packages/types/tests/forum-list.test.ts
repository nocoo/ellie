import { describe, expect, it } from "vitest";
import { forumListCacheKey, parseForumListContextRequest } from "../src/forum-list";

const request = {
	forumId: 1,
	page: 1,
	limit: 20,
	typeId: null,
	cachedBucket: null,
	cachedRevision: null,
	includeDisplay: true,
	includeStats: true,
	includeCount: true,
};

describe("forum list context contract", () => {
	it("accepts cold and warm requests without caller-supplied identity", () => {
		expect(parseForumListContextRequest(request)).toEqual({ ok: true, value: request });
		const warm = { ...request, cachedBucket: "member", cachedRevision: "a".repeat(64), typeId: 4 };
		expect(parseForumListContextRequest(warm)).toEqual({ ok: true, value: warm });
		expect(parseForumListContextRequest({ ...request, userId: 5 })).toEqual({
			ok: false,
			message: "Unknown field",
		});
	});

	it.each([null, undefined, [], "request", 4])("rejects malformed body %j", (body) => {
		expect(parseForumListContextRequest(body).ok).toBe(false);
	});

	it("accepts only bounded opaque cached reads", () => {
		for (const cachedRead of [null, "signed-token", "界".repeat(65_536)]) {
			expect(parseForumListContextRequest({ ...request, cachedRead })).toEqual({
				ok: true,
				value: { ...request, cachedRead },
			});
		}
		for (const cachedRead of [7, {}, "界".repeat(65_537)]) {
			expect(parseForumListContextRequest({ ...request, cachedRead }).ok).toBe(false);
		}
	});

	it("requires every field", () => {
		for (const key of Object.keys(request)) {
			const body = { ...request } as Record<string, unknown>;
			delete body[key];
			expect(parseForumListContextRequest(body).ok).toBe(false);
		}
	});

	it.each([
		["forumId", 0],
		["forumId", "1"],
		["forumId", 1.2],
		["page", -1],
		["page", Number.MAX_SAFE_INTEGER],
		["limit", 101],
		["limit", 0],
		["limit", "20"],
		["typeId", 0],
		["typeId", "1"],
		["cachedBucket", "public"],
		["cachedBucket", 1],
		["cachedRevision", "abc"],
		["cachedRevision", "A".repeat(64)],
		["cachedRevision", 1],
		["includeDisplay", 1],
		["includeStats", null],
		["includeCount", "false"],
	])("rejects invalid %s = %j", (key, value) => {
		expect(parseForumListContextRequest({ ...request, [key]: value }).ok).toBe(false);
	});

	it("isolates pages, categories and authorized buckets", () => {
		const keys = [
			forumListCacheKey("anon", 1, 1, 20, null),
			forumListCacheKey("member", 1, 1, 20, null),
			forumListCacheKey("anon", 2, 1, 20, null),
			forumListCacheKey("anon", 1, 2, 20, null),
			forumListCacheKey("anon", 1, 1, 40, null),
			forumListCacheKey("anon", 1, 1, 20, 3),
		];
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys[0]).toBe("forum:1:bucket:anon:page:1:limit:20:type:all");
	});
});

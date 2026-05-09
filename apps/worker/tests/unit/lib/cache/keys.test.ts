import { describe, expect, it } from "vitest";
import {
	digestFiltersKey,
	digestGenKey,
	digestListKey,
	digestStatsKey,
	forumMetaKey,
	forumSummaryGenKey,
	forumSummaryKey,
	forumTreeGenKey,
	forumTreeKey,
	pmInboxKey,
	pmUnreadKey,
	postListGenKey,
	postListKey,
	settingsAllKey,
	statsPublicKey,
	threadListGenKey,
	threadListKey,
	threadMetaGenKey,
	threadMetaKey,
	userMiniKey,
	userPublicKey,
} from "../../../../src/lib/cache/keys";

describe("cache/keys — v2 schema", () => {
	it("forumTreeKey embeds bucket and gen", () => {
		expect(forumTreeKey("anon", "abc")).toBe("forum:tree:v2:anon:gabc");
		expect(forumTreeKey("admin", "xyz")).toBe("forum:tree:v2:admin:gxyz");
	});

	it("forumSummaryKey embeds bucket and gen", () => {
		expect(forumSummaryKey("member", "g1")).toBe("forum:summary:v2:member:gg1");
	});

	it("forumMetaKey embeds forumId, bucket, gen", () => {
		expect(forumMetaKey(42, "staff", "t1")).toBe("forum:meta:v2:42:staff:gt1");
	});

	it("threadListKey embeds all parts incl. p1 marker", () => {
		expect(threadListKey(7, "newest", 20, "anon", "g1")).toBe(
			"thread:list:v2:7:newest:20:anon:p1:gg1",
		);
	});

	it("threadMetaKey embeds threadId/bucket/gen", () => {
		expect(threadMetaKey(123, "admin", "z")).toBe("thread:meta:v2:123:admin:gz");
	});

	it("postListKey embeds all parts", () => {
		expect(postListKey(5, 50, "member", "g")).toBe("post:list:v2:5:50:member:p1:gg");
	});

	it("digestListKey accepts numeric or 'all' for forumId/level/year", () => {
		expect(digestListKey("anon", "all", "all", "all", "g1")).toBe(
			"digest:list:v2:anon:all:all:all:p1:gg1",
		);
		expect(digestListKey("staff", 4, 2, 2026, "g2")).toBe("digest:list:v2:staff:4:2:2026:p1:gg2");
	});

	it("digestStatsKey / digestFiltersKey shape", () => {
		expect(digestStatsKey("admin", "g")).toBe("digest:stats:v2:admin:gg");
		expect(digestFiltersKey("anon", "g")).toBe("digest:filters:v2:anon:gg");
	});

	it("userMiniKey embeds id only", () => {
		expect(userMiniKey(99)).toBe("user:mini:v2:99");
	});

	it("userPublicKey enumerates viewer bucket", () => {
		expect(userPublicKey(7, "public")).toBe("user:public:v2:7:public");
		expect(userPublicKey(7, "staff")).toBe("user:public:v2:7:staff");
	});

	it("pmInboxKey embeds userId + box", () => {
		expect(pmInboxKey(11, "inbox")).toBe("pm:inbox:v2:11:inbox:p1");
		expect(pmInboxKey(11, "sent")).toBe("pm:inbox:v2:11:sent:p1");
	});

	it("pmUnreadKey is per-user", () => {
		expect(pmUnreadKey(11)).toBe("pm:unread:v2:11");
	});

	it("settingsAllKey / statsPublicKey are stable singletons", () => {
		expect(settingsAllKey()).toBe("settings:all:v2");
		expect(statsPublicKey()).toBe("stats:public:v2");
	});

	it("generation key inventory", () => {
		expect(forumTreeGenKey()).toBe("forum:tree:gen");
		expect(forumSummaryGenKey()).toBe("forum:summary:gen");
		expect(threadListGenKey(3)).toBe("thread:list:gen:3");
		expect(threadMetaGenKey(8)).toBe("thread:meta:gen:8");
		expect(postListGenKey(8)).toBe("post:list:gen:8");
		expect(digestGenKey()).toBe("digest:gen");
	});
});

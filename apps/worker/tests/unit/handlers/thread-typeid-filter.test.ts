import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { list } from "../../../src/handlers/thread";
import { refreshDailyStatistics } from "../../../src/lib/daily-statistics";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
	f.sqlite.exec("UPDATE forums SET thread_types_enabled=1 WHERE id=1");
	f.insert("forum_thread_types", { id: 11, source_typeid: 11, forum_id: 1, name: "Question" });
	f.insert("forum_thread_types", { id: 12, source_typeid: 12, forum_id: 2, name: "Other" });
	f.insert("forum_thread_types", {
		id: 13,
		source_typeid: 13,
		forum_id: 1,
		name: "Disabled",
		enabled: 0,
	});
	f.thread(1, { type_id: 11, type_name: "Question" });
	f.thread(2, { type_id: 0 });
	f.thread(3, { forum_id: 2, sticky: 2 });
});
afterEach(async () => {
	await Promise.all(f.ctx._waitUntilPromises);
	f.close();
});
const read = (query: string) =>
	list(new Request(`https://x/api/v1/threads?forumId=1${query}`), f.env, f.ctx);

describe("GET threads typeId filter", () => {
	it.each(["", "&typeId=", "&typeId=0"])(
		"absent/zero filter %s includes global announcements",
		async (query) => {
			f.sqlite.exec("UPDATE forums SET visibility = 'public' WHERE id = 2");
			const response = await read(query);
			expect(response.status).toBe(200);
			expect((await response.json()).data.map((row: { id: number }) => row.id)).toEqual([3, 2, 1]);
			expect(f.calls.some((call) => call.sql.includes("FROM forum_thread_types"))).toBe(false);
		},
	);

	it.each(["abc", "1abc", "-1", "1.5", "01", "+1", "9007199254740992"])(
		"rejects malformed typeId=%s before D1",
		async (typeId) => {
			expect((await read(`&typeId=${encodeURIComponent(typeId)}`)).status).toBe(400);
			expect(f.calls).toHaveLength(0);
		},
	);

	it("rejects a disabled forum configuration without looking up a type", async () => {
		f.sqlite.exec("UPDATE forums SET thread_types_enabled=0 WHERE id=1");
		expect((await read("&typeId=11")).status).toBe(400);
		expect(f.calls).toHaveLength(1);
		expect(f.snapshots("thread:list")).toHaveLength(0);
	});

	it.each([12, 13, 999])("rejects foreign/disabled/missing typeId=%i", async (typeId) => {
		expect((await read(`&typeId=${typeId}`)).status).toBe(400);
		expect(f.calls.find((call) => call.sql.includes("FROM forum_thread_types"))?.params).toEqual([
			typeId,
			1,
		]);
		expect(f.snapshots("thread:list")).toHaveLength(0);
	});

	it("filters counts and rows to the exact forum/type and caches deep pages", async () => {
		for (let id = 4; id <= 34; id++) f.thread(id, { type_id: 11, type_name: "Question" });
		await refreshDailyStatistics(f.env);
		f.calls.length = 0;
		const response = await read("&typeId=11&page=2&limit=25");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.meta).toMatchObject({ total: 32, page: 2, limit: 25, pages: 2 });
		expect(body.data.map((row: { id: number }) => row.id)).toEqual([9, 8, 7, 6, 5, 4, 1]);
		const snapshots = f.snapshots("thread:list");
		expect(snapshots).toHaveLength(1);
		expect(f.snapshots("thread:count")).toEqual([]);
		expect(snapshots.find((entry) => entry.params.kind === "local")).toMatchObject({
			tier: "SHORT",
			params: { kind: "local", forumId: 1, typeId: 11, limit: 26, offset: 25 },
		});
		f.calls.length = 0;
		expect((await (await read("&typeId=11&page=2&limit=25")).json()).data).toEqual(body.data);
		expect(f.calls).toHaveLength(4);
		expect(f.calls.filter((call) => call.sql.includes("COUNT(*)"))).toHaveLength(0);
		expect(f.calls.filter((call) => call.sql.includes("t.replies, t.views"))).toHaveLength(1);
		expect(f.calls.some((call) => call.sql.includes("ORDER BY"))).toBe(false);
	});

	it("checks current forum access before consulting a category or cached membership", async () => {
		await read("&typeId=11");
		f.sqlite.exec("UPDATE forums SET visibility='staff' WHERE id=1");
		f.calls.length = 0;
		expect((await read("&typeId=11")).status).toBe(403);
		expect(f.calls).toHaveLength(1);
	});

	it("a category disabled after cache warming is rejected immediately", async () => {
		await read("&typeId=11");
		f.sqlite.exec("UPDATE forum_thread_types SET enabled=0 WHERE id=11");
		expect((await read("&typeId=11")).status).toBe(400);
	});
});

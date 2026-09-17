import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { list } from "../../../../src/handlers/admin/announcement";
import { inspectCacheEntry, rebuildCacheEntry } from "../../../../src/lib/cache/manage";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "../../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(Date.UTC(2026, 8, 17));
	f = readingFixture();
	const now = Math.floor(Date.now() / 1000);
	for (const [id, forums, start, end, status] of [
		[1, "", null, null, 1],
		[2, "1", null, null, 1],
		[3, "10", null, null, 1],
		[4, "2,1", null, null, 1],
		[5, "1", now + 3600, null, 1],
		[6, "1", null, now, 1],
		[7, "1", null, null, 0],
	] as const) {
		f.insert("announcements", {
			id,
			title: `Announcement ${id}`,
			forum_ids: forums,
			start_at: start,
			end_at: end,
			status,
			author_id: 1,
			created_at: id,
		});
	}
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
});

async function read(query: string) {
	const response = await list(
		createAdminRequest("GET", `/api/admin/announcements?${query}`),
		f.env,
	);
	expect(response.status).toBe(200);
	return response.json<{ data: { id: number; title: string }[]; meta: { total: number } }>();
}

describe("admin announcement cache", () => {
	it("normalizes equivalent filters, performs no hot SQL, and expires at exactly 60 seconds", async () => {
		expect((await read("active=true&forumId=1&limit=2")).data.map((row) => row.id)).toEqual([4, 2]);
		expect(f.calls).toHaveLength(2);
		const original = [...f.values.values()][0];
		f.sqlite.exec("UPDATE announcements SET title = 'Changed' WHERE id = 4");
		f.calls.length = 0;
		vi.setSystemTime(Date.now() + 59_999);
		expect((await read("page=1&limit=2&forumId=01&active=1")).data[0].title).toBe("Announcement 4");
		expect(f.calls).toHaveLength(0);
		expect([...f.values.values()][0]).toBe(original);
		vi.setSystemTime(Date.now() + 1);
		expect((await read("active=true&forumId=1&limit=2")).data[0].title).toBe("Changed");
		expect(f.calls).toHaveLength(2);
	});
	it.each([
		["active=true&forumId=1&page=2&limit=2", [1], 3],
		["active=true&forumId=10", [3, 1], 2],
		["status=0&forumId=1", [7], 1],
		["status=0&active=true", [], 0],
	] as const)("keeps the %s query combination separate", async (query, ids, total) => {
		await read("active=true&forumId=1&limit=2");
		const response = await read(query);
		expect(response.data.map((row) => row.id)).toEqual(ids);
		expect(response.meta.total).toBe(total);
	});
	it("rebuild preserves original filters and scope; inspect reads only KV", async () => {
		await read("active=true&forumId=1&limit=2");
		const key = [...f.values.keys()][0];
		f.calls.length = 0;
		expect(await inspectCacheEntry(f.env, key)).toMatchObject({ valid: true });
		expect(f.calls).toHaveLength(0);
		f.sqlite.exec("UPDATE announcements SET title = 'Rebuilt' WHERE id = 4");
		const envelope = await rebuildCacheEntry(f.env, undefined, key);
		expect(envelope).toMatchObject({
			tier: "SHORT",
			scope: "admin",
			params: { entity: "announcements", query: "active=1&forumId=1&limit=2&page=1" },
			data: { items: [{ id: 4, title: "Rebuilt" }, { id: 2 }] },
		});
		expect(f.calls.every((call) => call.mode !== "run")).toBe(true);
	});
	it("does not turn a failed SELECT into a cached empty list", async () => {
		f.state.queryError = true;
		await expect(read("active=true&forumId=1")).rejects.toThrow("could not be loaded");
		expect(f.values.size).toBe(0);
	});
});

import { afterEach, beforeEach, expect, it } from "vitest";
import { getMessages } from "../../../../src/lib/cache/private-read";
import { loadPostAccessBatch, loadPostEntities } from "../../../../src/lib/cache/thread-loaders";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
});
afterEach(() => {
	f.close();
});
function plans() {
	return f.calls.map(({ sql, params }) => ({
		sql,
		details: f.sqlite
			.prepare(`EXPLAIN QUERY PLAN ${sql}`)
			.all(...params)
			.map((r) => r.detail)
			.join("\n"),
	}));
}
it("seeks known post IDs and keeps thread and visibility guards", async () => {
	f.thread(1);
	f.thread(2);
	for (let id = 1; id <= 500; id++) f.post(id);
	f.post(501, { thread_id: 2 });
	f.post(502, { invisible: 1 });
	const ids = [...Array.from({ length: 20 }, (_, i) => i + 1), 501, 502];
	const access = await loadPostAccessBatch(f.env, ids, 1);
	expect([...access.keys()]).toEqual(ids.slice(0, 20));
	const rows = await loadPostEntities(f.env, [...access.keys()], 1);
	expect(rows.size).toBe(20);
	for (const plan of plans()) {
		expect(plan.details).toContain("USING INTEGER PRIMARY KEY");
		expect(plan.details).not.toContain("SCAN");
	}
});
it("seeks message IDs while excluding other users and deleted messages", async () => {
	for (let id = 1; id <= 200; id++)
		f.insert("messages", {
			id,
			sender_id: 10,
			receiver_id: 20,
			sender_name: "alice",
			receiver_name: "bob",
			created_at: 1,
			subject: "s",
			content: "c",
		});
	f.insert("messages", {
		id: 201,
		sender_id: 20,
		receiver_id: 30,
		sender_name: "bob",
		receiver_name: "mod",
		created_at: 1,
		subject: "s",
		content: "private",
	});
	f.insert("messages", {
		id: 202,
		sender_id: 10,
		receiver_id: 20,
		sender_name: "alice",
		receiver_name: "bob",
		sender_deleted: 1,
		created_at: 1,
		subject: "s",
		content: "deleted",
	});
	const rows = await getMessages(f.env, undefined, 10, [
		...Array.from({ length: 20 }, (_, i) => i + 1),
		201,
		202,
	]);
	expect(rows.size).toBe(20);
	for (const plan of plans()) {
		expect(plan.details).toContain("USING INTEGER PRIMARY KEY");
		expect(plan.details).not.toContain("SCAN");
	}
});

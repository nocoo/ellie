import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { list as listForums, summaries, summaryGates } from "../../../src/handlers/forum";
import { count, list } from "../../../src/handlers/thread";
import { refreshDailyStatistics } from "../../../src/lib/daily-statistics";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("memory statistics guards", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-17T01:00:00Z"));
		f = readingFixture();
	});
	afterEach(() => {
		f.close();
		vi.useRealTimers();
	});

	async function call(path: string) {
		const request = new Request(`https://test${path}`);
		const response = path.startsWith("/api/v1/threads/count")
			? await count(request, f.env, f.ctx)
			: path.startsWith("/api/v1/forums/summary-gates")
				? await summaryGates(request, f.env)
				: await list(request, f.env, f.ctx);
		return { status: response.status, body: await response.json() };
	}

	it("omits anonymous and hidden topic gates instead of returning their authors", async () => {
		f.thread(41, { anonymous_author: 1, author_id: 10, sticky: 0 });
		f.thread(42, { sticky: -1, author_id: 20 });
		f.thread(43, { sticky: 0, author_id: 10, anonymous_author: 0 });
		const result = await call("/api/v1/forums/summary-gates?topics=41,42,43");
		expect(result.status).toBe(200);
		expect(result.body.data.map((row: { topicId: number }) => row.topicId)).toEqual([43]);
		expect(result.body.data[0]).toMatchObject({ authorId: 10, anonymousAuthor: 0, sticky: 0 });
		expect(JSON.stringify(result.body.data)).not.toContain('"topicId":41');
		expect(JSON.stringify(result.body.data)).not.toContain('"topicId":42');
	});

	it("does not let an invisible global announcement consume offset or inflate the count", async () => {
		f.thread(7, { forum_id: 2, sticky: 2, last_post_at: 500 });
		f.thread(8, { forum_id: 1, sticky: 0, last_post_at: 20 });
		f.thread(9, { forum_id: 1, sticky: 0, last_post_at: 10 });
		await refreshDailyStatistics(f.env);
		f.calls.length = 0;
		const page1 = await call("/api/v1/threads?forumId=1&page=1&limit=1&includeTotal=false");
		const page2 = await call("/api/v1/threads?forumId=1&page=2&limit=1&includeTotal=false");
		const total = await call("/api/v1/threads/count?forumId=1");
		expect(page1.body.data.map((row: { id: number }) => row.id)).toEqual([8]);
		expect(page1.body.meta.hasNext).toBe(true);
		expect(page2.body.data.map((row: { id: number }) => row.id)).toEqual([9]);
		expect(page2.body.meta.hasNext).toBe(false);
		expect(total.body.data.total).toBe(2);
		expect(f.calls.some((call) => call.sql.includes("COUNT(*)"))).toBe(false);
	});

	it("does not rebuild membership on a warm page that already has the extra row", async () => {
		f.thread(8, { forum_id: 1, sticky: 0, last_post_at: 20 });
		f.thread(9, { forum_id: 1, sticky: 0, last_post_at: 10 });
		await call("/api/v1/threads?forumId=1&page=1&limit=1&includeTotal=false");
		f.calls.length = 0;
		const warm = await call("/api/v1/threads?forumId=1&page=1&limit=1&includeTotal=false");
		expect(warm.body.data.map((row: { id: number }) => row.id)).toEqual([8]);
		expect(warm.body.meta.hasNext).toBe(true);
		expect(
			f.calls.filter((call) => call.sql.includes("ORDER BY") && call.sql.includes("LIMIT")),
		).toHaveLength(0);
	});

	it("returns visible structure without numeric or topic data and summarizes topic creation", async () => {
		f.thread(51, { subject: "Earlier", created_at: 10, last_post_at: 1000 });
		f.thread(52, { subject: "Latest topic", created_at: 20, last_post_at: 20 });
		f.thread(53, { subject: "Anonymous", created_at: 30, anonymous_author: 1 });
		const structureResponse = await listForums(
			new Request("https://test/api/v1/forums?view=structure"),
			f.env,
			f.ctx,
		);
		const structure = await structureResponse.json();
		expect(structure.meta.bucket).toBe("anon");
		expect(structure.data.every((row: { id: number }) => row.id !== 2)).toBe(true);
		expect(structure.data.find((row: { id: number }) => row.id === 1)).toMatchObject({
			threads: 0,
			posts: 0,
			todayThreads: 0,
			lastThreadId: 0,
			lastThreadSubject: "",
			lastPosterId: 0,
		});
		f.calls.length = 0;
		const response = await summaries(
			new Request("https://test/api/v1/forums/summaries"),
			f.env,
			f.ctx,
		);
		const body = await response.json();
		expect(body.meta.bucket).toBe("anon");
		expect(body.data.find((row: { forumId: number }) => row.forumId === 1)).toMatchObject({
			topicId: 52,
			topicSubject: "Latest topic",
			topicCreatedAt: 20,
			authorId: 10,
		});
		expect(body.data.some((row: { forumId: number }) => row.forumId === 2)).toBe(false);
		expect([...f.values.keys()].some((key) => key.includes("forum:summary"))).toBe(false);
	});

	it.each(["", "?topics=1,1", "?topics=0", "?topics=1&unknown=1"])(
		"rejects invalid summary gate query %s",
		async (query) => {
			const response = await call(`/api/v1/forums/summary-gates${query}`);
			expect(response.status).toBe(400);
			expect(f.calls).toHaveLength(0);
		},
	);

	it.each([
		"",
		"?forumId=0",
		"?forumId=1&forumId=1",
		"?forumId=1&typeId=0",
		"?forumId=1&bucket=admin",
	])("rejects invalid count query %s", async (query) => {
		expect((await call(`/api/v1/threads/count${query}`)).status).toBe(400);
		expect(f.calls).toHaveLength(0);
	});

	it("applies count visibility and absent-forum gates", async () => {
		expect((await call("/api/v1/threads/count?forumId=2")).status).toBe(403);
		expect((await call("/api/v1/threads/count?forumId=999")).status).toBe(404);
	});
});

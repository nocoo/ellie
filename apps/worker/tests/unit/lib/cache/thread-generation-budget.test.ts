import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { list } from "../../../../src/handlers/thread";
import { bumpThreadMetaGen } from "../../../../src/lib/cache/invalidate";
import { getThreadRows, readingCacheKey } from "../../../../src/lib/cache/thread-loaders";
import { getUserProfiles, invalidateUserCache } from "../../../../src/lib/user-cache";
import { deferred, readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	f.thread(1, { replies: 1, views: 10 });
	f.thread(2, { replies: 2, views: 20 });
	f.post(1);
});

afterEach(() => {
	f.close();
	vi.useRealTimers();
});

function metaGenGets(): string[] {
	return vi
		.mocked(f.env.KV.get)
		.mock.calls.flatMap(([key]) => key)
		.filter((key): key is string => typeof key === "string" && key.startsWith("thread:meta:gen:"));
}

async function fillConcurrentThreadEntities(): Promise<void> {
	const ids = Array.from({ length: 100 }, (_, index) => index + 2001);
	for (const id of ids) f.thread(id, { forum_id: 2 });
	await getThreadRows(f.env, f.ctx, ids);
	await vi.waitFor(() => expect(f.env.KV.put).toHaveBeenCalledTimes(100));
}

describe("getThreadRows shares thread meta generations inside one call", () => {
	it("reads each entity generation once and batches uncached stats separately", async () => {
		await getThreadRows(f.env, undefined, [1, 2, 1]);
		expect(metaGenGets().sort()).toEqual(["thread:meta:gen:1", "thread:meta:gen:2"]);
		expect(f.env.KV.get).toHaveBeenCalledTimes(2);
		expect(f.calls).toHaveLength(2);
		expect(f.calls.find((call) => call.sql.includes("t.replies, t.views"))?.params).toEqual([1, 2]);
		expect(f.snapshots("thread:stats")).toEqual([]);
		expect(vi.mocked(f.env.KV.get).mock.calls.every(([key]) => Array.isArray(key))).toBe(true);
		for (const snapshot of f.snapshots("thread:entity")) {
			expect(await readingCacheKey(f.env, snapshot)).toBe(snapshot.key);
		}
	});

	it("a later getThreadRows call observes a newly bumped epoch", async () => {
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("Thread 1");
		const previous = f.snapshots("thread:entity")[0].key;
		f.sqlite.exec("UPDATE threads SET subject = 'Edited' WHERE id = 1");
		await bumpThreadMetaGen(f.env, 1);
		vi.mocked(f.env.KV.get).mockClear();
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("Edited");
		expect(metaGenGets()).toEqual(["thread:meta:gen:1"]);
		const snapshot = f.snapshots("thread:entity").at(-1);
		expect(snapshot?.key).not.toBe(previous);
		expect(await readingCacheKey(f.env, snapshot)).toBe(snapshot?.key);
		expect(f.snapshots("thread:stats")).toEqual([]);
	});

	it("generation KV failure bypasses cache and does not serve the previous snapshot", async () => {
		await getThreadRows(f.env, undefined, [1]);
		const stored = f.snapshots("thread:entity").map((snapshot) => snapshot.key);
		f.sqlite.exec("UPDATE threads SET subject = 'Edited' WHERE id = 1");
		const original = vi.mocked(f.env.KV.get).getMockImplementation();
		vi.mocked(f.env.KV.get).mockImplementation(async (key, type) => {
			if (Array.isArray(key) && key.some((item) => item.startsWith("thread:meta:gen:"))) {
				throw new Error("KV unavailable");
			}
			return original?.(key, type);
		});
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("Edited");
		expect([...f.values.keys()].some((key) => key.includes("!unavailable"))).toBe(false);
		expect(f.snapshots("thread:entity").map((snapshot) => snapshot.key)).toEqual(stored);
		expect(f.snapshots("thread:entity")[0].data).toMatchObject({ subject: "Thread 1" });
	});

	it("reads 101 generations in two bounded bulk calls", async () => {
		for (let id = 3; id <= 101; id++) f.thread(id);
		const ids = Array.from({ length: 101 }, (_, i) => i + 1);
		const original = vi.mocked(f.env.KV.get).getMockImplementation();
		let inflight = 0;
		let peak = 0;
		vi.mocked(f.env.KV.get).mockImplementation(async (key, type) => {
			if (Array.isArray(key) && key.some((item) => item.startsWith("thread:meta:gen:"))) {
				inflight += 1;
				peak = Math.max(peak, inflight);
				try {
					return await original?.(key, type);
				} finally {
					inflight -= 1;
				}
			}
			return original?.(key, type);
		});
		expect((await getThreadRows(f.env, undefined, ids)).size).toBe(101);
		expect(
			f.calls
				.filter((call) => call.sql.includes("t.replies, t.views"))
				.map((call) => call.params.length),
		).toEqual([100, 1]);
		const gens = metaGenGets();
		expect(gens).toHaveLength(101);
		expect(new Set(gens).size).toBe(101);
		expect(peak).toBeLessThanOrEqual(100);
		expect(peak).toBe(1);
		expect(
			vi
				.mocked(f.env.KV.get)
				.mock.calls.filter(([key]) => Array.isArray(key) && key[0]?.startsWith("thread:meta:gen:"))
				.map(([key]) => key.length),
		).toEqual([100, 1]);
	});

	it("a cold 100-thread request waits for admission behind concurrent slow fills", async () => {
		for (let id = 1; id <= 100; id++) {
			f.insert("users", { id: id + 1000, username: `author${id}` });
			if (id > 2) f.thread(id);
			f.sqlite.prepare("UPDATE threads SET author_id = ? WHERE id = ?").run(id + 1000, id);
		}
		const gate = deferred();
		f.state.writeGate = gate.promise;
		await fillConcurrentThreadEntities();
		let settled = false;
		const request = list(
			new Request("http://localhost/api/v1/threads?forumId=1&page=1&limit=100"),
			f.env,
			f.ctx,
		).finally(() => {
			settled = true;
		});
		try {
			await vi.waitFor(() => expect(f.env.KV.put).toHaveBeenCalledTimes(256));
			expect(settled).toBe(false);
		} finally {
			gate.resolve();
		}
		const response = await request;
		expect(response.status).toBe(200);
		expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(100);
		await Promise.all(f.ctx._waitUntilPromises);
	});

	it("does not refill captured batch rows when invalidation finishes before admission", async () => {
		for (let id = 1; id <= 100; id++) {
			f.insert("users", { id: id + 1000, username: `before${id}` });
			if (id > 2) f.thread(id);
			f.sqlite.prepare("UPDATE threads SET author_id = ? WHERE id = ?").run(id + 1000, id);
		}
		const gate = deferred();
		f.state.writeGate = gate.promise;
		await fillConcurrentThreadEntities();
		const request = list(
			new Request("http://localhost/api/v1/threads?forumId=1&page=1&limit=100"),
			f.env,
			f.ctx,
		);
		try {
			await vi.waitFor(() => expect(f.env.KV.put).toHaveBeenCalledTimes(256));
			expect(
				f.calls.some(
					(call) => call.sql.includes("FROM users WHERE id IN") && call.params.includes(1030),
				),
			).toBe(true);
			expect(vi.mocked(f.env.KV.put).mock.calls.some(([key]) => key === "user:mini:1030")).toBe(
				false,
			);
			f.sqlite.prepare("UPDATE users SET username = ? WHERE id = ?").run("after30", 1030);
			await invalidateUserCache(f.env, 1030, { strict: true });
		} finally {
			gate.resolve();
		}
		expect((await request).status).toBe(200);
		await Promise.all(f.ctx._waitUntilPromises);
		expect(f.values.has("user:mini:1030")).toBe(false);
		expect((await getUserProfiles(f.env, undefined, [1030])).get(1030)?.username).toBe("after30");
	});

	it("a paused old load cannot fill the new thread meta generation", async () => {
		const paused = deferred();
		const release = deferred();
		let once = true;
		f.state.afterRead = async (sql) => {
			if (once && sql.includes("t.subject")) {
				once = false;
				paused.resolve();
				await release.promise;
			}
		};
		const old = getThreadRows(f.env, undefined, [1]);
		await paused.promise;
		f.sqlite.exec("UPDATE threads SET subject = 'New subject' WHERE id = 1");
		await bumpThreadMetaGen(f.env, 1);
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("New subject");
		release.resolve();
		expect((await old).get(1)?.subject).toBe("Thread 1");
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("New subject");
	});
});

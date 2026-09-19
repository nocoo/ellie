import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { list } from "../../../../src/handlers/thread";
import { bumpThreadMetaGen } from "../../../../src/lib/cache/invalidate";
import { getThreadRows, readingCacheKey } from "../../../../src/lib/cache/thread-loaders";
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

describe("getThreadRows shares thread meta generations inside one call", () => {
	it("reads each thread meta gen once for entity and stats together", async () => {
		await getThreadRows(f.env, undefined, [1, 2, 1]);
		expect(metaGenGets().sort()).toEqual(["thread:meta:gen:1", "thread:meta:gen:2"]);
		// Generations, entities and stats: three bulk reads, no per-entity miss re-read.
		expect(f.env.KV.get).toHaveBeenCalledTimes(3);
		expect(vi.mocked(f.env.KV.get).mock.calls.every(([key]) => Array.isArray(key))).toBe(true);
		for (const family of ["thread:entity", "thread:stats"] as const) {
			for (const snapshot of f.snapshots(family)) {
				expect(await readingCacheKey(f.env, snapshot)).toBe(snapshot.key);
			}
		}
	});

	it("a later getThreadRows call observes a newly bumped epoch", async () => {
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("Thread 1");
		const previous = Object.fromEntries(
			(["thread:entity", "thread:stats"] as const).map((family) => [
				family,
				f.snapshots(family)[0].key,
			]),
		);
		f.sqlite.exec("UPDATE threads SET subject = 'Edited' WHERE id = 1");
		await bumpThreadMetaGen(f.env, 1);
		vi.mocked(f.env.KV.get).mockClear();
		expect((await getThreadRows(f.env, undefined, [1])).get(1)?.subject).toBe("Edited");
		expect(metaGenGets()).toEqual(["thread:meta:gen:1"]);
		for (const family of ["thread:entity", "thread:stats"] as const) {
			const snapshot = f.snapshots(family).at(-1);
			expect(snapshot?.key).not.toBe(previous[family]);
			expect(await readingCacheKey(f.env, snapshot as CacheDescriptor)).toBe(snapshot?.key);
		}
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

	it("a cold 100-thread request waits for slow fills before admitting author reads", async () => {
		for (let id = 1; id <= 100; id++) {
			f.insert("users", { id: id + 1000, username: `author${id}` });
			if (id > 2) f.thread(id);
			f.sqlite.prepare("UPDATE threads SET author_id = ? WHERE id = ?").run(id + 1000, id);
		}
		const gate = deferred();
		f.state.writeGate = gate.promise;
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

	it("a paused old load cannot fill the new thread meta generation", async () => {
		const paused = deferred();
		const release = deferred();
		let once = true;
		f.state.afterRead = async (sql) => {
			// Stats and entity hashes may resolve in either order; pause the captured subject.
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

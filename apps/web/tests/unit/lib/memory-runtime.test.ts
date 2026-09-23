import type { StatisticsBatchRequest, StatisticsBatchResult } from "@ellie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMemoryRuntime, MemoryRuntime, readBoundedJson } from "@/lib/memory-runtime";

const query = { page: 1, limit: 100 };
const confirm = async (body: StatisticsBatchRequest): Promise<StatisticsBatchResult> => ({
	views: body.views.map((item) => ({ ...item, status: "confirmed" })),
	activities: body.activities.map((item) => ({ ...item, status: "confirmed" })),
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe("bounded process cache", () => {
	it("shares the production singleton", () => {
		expect(getMemoryRuntime()).toBe(getMemoryRuntime());
	});

	it("deduplicates cold loads, clones values, expires and never caches errors", async () => {
		let now = Date.UTC(2026, 8, 23);
		const runtime = new MemoryRuntime({ now: () => now });
		const value = deferred<{ total: number }>();
		const load = vi.fn(() => value.promise);
		const first = runtime.read("thread-count", "anon:1", load);
		const second = runtime.read("thread-count", "anon:1", load);
		value.resolve({ total: 2 });
		const [a, b] = await Promise.all([first, second]);
		a.total = 100;
		expect(b.total).toBe(2);
		expect(load).toHaveBeenCalledTimes(1);
		expect(await runtime.read("thread-count", "anon:1", load)).toEqual({ total: 2 });
		const before = runtime.snapshot(query);
		runtime.snapshot(query);
		expect(runtime.snapshot(query).families).toEqual(before.families);
		now += 300_000;
		const fail = vi.fn().mockRejectedValue(new Error("offline"));
		await expect(runtime.read("thread-count", "anon:1", fail)).rejects.toThrow("offline");
		await expect(runtime.read("thread-count", "anon:1", fail)).rejects.toThrow("offline");
		expect(fail).toHaveBeenCalledTimes(2);
		expect(runtime.snapshot(query).families.find((f) => f.id === "thread-count")?.loadErrors).toBe(
			2,
		);
	});

	it("clear deduplicates new loads and fences old completion", async () => {
		const runtime = new MemoryRuntime();
		const value = deferred<number>();
		const old = runtime.read("thread-count", "a", () => value.promise);
		runtime.clear("thread-count", "a");
		const fresh = deferred<number>();
		const load = vi.fn(() => fresh.promise);
		const first = runtime.read("thread-count", "a", load);
		const second = runtime.read("thread-count", "a", load);
		fresh.resolve(3);
		expect(await Promise.all([first, second])).toEqual([3, 3]);
		expect(load).toHaveBeenCalledTimes(1);
		value.resolve(2);
		expect(await old).toBe(2);
		expect(await runtime.read("thread-count", "a", async () => 4)).toBe(3);
		runtime.clear("site-stats");
		expect(runtime.snapshot(query).entries).toHaveLength(1);
		runtime.clear();
		expect(runtime.snapshot(query).entries).toEqual([]);
	});

	it("repeated clears cannot exceed the tracked-flight cap", async () => {
		const runtime = new MemoryRuntime();
		const old = deferred<number>();
		const tasks: Promise<number>[] = [];
		for (let i = 0; i < 64; i++) {
			tasks.push(runtime.read("thread-count", "same", () => old.promise));
			runtime.clear();
		}
		await expect(runtime.read("thread-count", "same", async () => 3)).rejects.toThrow(
			"capacity exceeded",
		);
		expect(runtime.snapshot(query).entries).toEqual([]);
		old.resolve(2);
		await Promise.all(tasks);
		await runtime.read("thread-count", "same", async () => 4);
		expect(runtime.snapshot(query).entries).toHaveLength(1);
	});

	it("expires at Shanghai midnight, including a load spanning the boundary", async () => {
		let now = Date.UTC(2026, 8, 23, 15, 59, 59);
		const runtime = new MemoryRuntime({ now: () => now });
		await runtime.read("site-stats", "site", async () => ({ todayPosts: 4 }));
		expect(runtime.snapshot(query).entries[0].expiresAt).toBe("2026-09-23T16:00:00.000Z");
		const value = deferred<number>();
		const old = runtime.read("thread-count", "1", () => value.promise);
		now += 1000;
		value.resolve(1);
		await old;
		expect(runtime.snapshot(query).entries).toEqual([]);
	});

	it("caps family entries and keeps overflow readable", async () => {
		const runtime = new MemoryRuntime();
		for (let i = 0; i < 260; i++)
			expect(await runtime.read("forum-summary", String(i), async () => ({ forumId: i }))).toEqual({
				forumId: i,
			});
		const snapshot = runtime.snapshot({ family: "forum-summary", page: 3, limit: 100 });
		expect(snapshot.pagination).toEqual({ page: 3, limit: 100, total: 256 });
		expect(snapshot.entries).toHaveLength(56);
		expect(snapshot.families.find((f) => f.id === "forum-summary")?.evictions).toBe(4);
	});

	it("bounds tracked flights, payload and previews without leaking topic content", async () => {
		const runtime = new MemoryRuntime();
		const value = deferred<number>();
		const tasks = Array.from({ length: 64 }, (_, id) =>
			runtime.read("thread-count", String(id), () => value.promise),
		);
		const overflow = vi.fn(async () => 12);
		const rejected = await Promise.allSettled(
			Array.from({ length: 300 }, (_, id) =>
				runtime.read("thread-count", `overflow:${id}`, overflow),
			),
		);
		expect(rejected.every((result) => result.status === "rejected")).toBe(true);
		expect(overflow).not.toHaveBeenCalled();
		const duplicate = runtime.read("thread-count", "0", overflow);
		expect(runtime.snapshot(query).pagination.total).toBe(0);
		value.resolve(1);
		await Promise.all(tasks);
		expect(await duplicate).toBe(1);
		expect(overflow).not.toHaveBeenCalled();
		expect(await runtime.read("thread-count", "overflow", overflow)).toBe(12);
		await runtime.read("forum-summary", "private", async () => ({
			topicId: 1,
			topicSubject: "secret",
			authorName: "private-user",
			forumId: 2,
		}));
		const entry = runtime.snapshot({ ...query, family: "forum-summary" }).entries[0];
		expect(entry.preview).toBe('{"forumId":2,"topicId":1}');
		await runtime.read("thread-count", "oversize", async () => "a".repeat(20_000));
		await expect(runtime.read("thread-count", "a".repeat(257), overflow)).rejects.toThrow(
			"key is too long",
		);
		for (let id = 0; id < 1024; id++)
			await runtime.read("thread-count", String(id), async () => ({
				total: 1,
				bounded: "a".repeat(15_000),
			}));
		const snapshot = runtime.snapshot(query);
		expect(snapshot.memory.estimatedPayloadBytes).toBeLessThan(snapshot.memory.payloadLimitBytes);
		expect(snapshot.families.find((f) => f.id === "thread-count")?.entries).toBeLessThan(1024);
	});
});

describe("lossy statistics buffer", () => {
	it("serializes manual and timer flushes while preserving new events", async () => {
		const response = deferred<StatisticsBatchResult>();
		const send = vi.fn(() => response.promise);
		const runtime = new MemoryRuntime({ send });
		runtime.recordView(1);
		const first = runtime.flush();
		expect(runtime.flush()).toBe(first);
		await Promise.resolve();
		runtime.recordView(1);
		expect(runtime.snapshot(query).buffers).toMatchObject({ flushing: true, pendingViews: 2 });
		response.resolve(await confirm({ views: [{ threadId: 1, increment: 1 }], activities: [] }));
		await first;
		expect(send).toHaveBeenCalledTimes(1);
		expect(runtime.snapshot(query).buffers).toMatchObject({ pendingViews: 1, flushing: false });
		runtime.clear();
		expect(runtime.snapshot(query).buffers.pendingViews).toBe(1);
	});

	it("bounds detached plus active view IDs and per-thread increments", async () => {
		const response = deferred<StatisticsBatchResult>();
		const send = vi.fn(async (body: StatisticsBatchRequest) => {
			if (send.mock.calls.length === 1) return response.promise;
			return confirm(body);
		});
		const runtime = new MemoryRuntime({ send });
		for (let id = 1; id <= 2049; id++) runtime.recordView(id);
		for (let i = 0; i < 1000; i++) runtime.recordView(1);
		expect(runtime.snapshot(query).buffers).toMatchObject({
			pendingThreads: 2048,
			droppedViews: 2,
		});
		const flush = runtime.flush();
		await Promise.resolve();
		runtime.recordView(3000);
		expect(runtime.snapshot(query).buffers.droppedViews).toBe(3);
		response.resolve(await confirm(send.mock.calls[0][0]));
		await flush;
		expect(send).toHaveBeenCalledTimes(8);
		expect(send.mock.calls.every(([body]) => body.views.length <= 256)).toBe(true);
		expect(runtime.snapshot(query).buffers.pendingViews).toBe(0);
	});

	it("accounts rejected and uncertain views without retrying them", async () => {
		const send = vi.fn(
			async (body: StatisticsBatchRequest): Promise<StatisticsBatchResult> => ({
				views: body.views.map((item, i) => ({
					...item,
					status: i === 0 ? "rejected" : "unconfirmed",
				})),
				activities: [],
			}),
		);
		const runtime = new MemoryRuntime({ send });
		runtime.recordView(1);
		runtime.recordView(2);
		runtime.recordView(2);
		await runtime.flush();
		await runtime.flush();
		expect(send).toHaveBeenCalledTimes(1);
		expect(runtime.snapshot(query).buffers).toMatchObject({
			droppedViews: 1,
			unconfirmedViews: 2,
			pendingViews: 0,
		});
	});

	it("treats errors and mismatched accounting as unconfirmed", async () => {
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error("lost response"))
			.mockResolvedValueOnce({ views: [], activities: [] });
		const runtime = new MemoryRuntime({ send });
		for (let i = 1; i <= 2; i++) {
			runtime.recordView(i);
			await runtime.flush();
		}
		expect(runtime.snapshot(query).buffers.unconfirmedViews).toBe(2);
	});

	it("throttles activities, preserves newer in-flight observations and invalidates online baselines", async () => {
		let now = Date.UTC(2026, 8, 23);
		const response = deferred<StatisticsBatchResult>();
		const send = vi.fn(async (body: StatisticsBatchRequest) =>
			send.mock.calls.length === 1 ? response.promise : confirm(body),
		);
		const runtime = new MemoryRuntime({ now: () => now, send });
		await runtime.read("site-stats", "site", async () => 3);
		runtime.recordActivity(1);
		const flush = runtime.flush();
		await Promise.resolve();
		now += 1000;
		runtime.recordActivity(1);
		response.resolve(await confirm(send.mock.calls[0][0]));
		await flush;
		expect(runtime.snapshot(query).entries).toHaveLength(0);
		expect(runtime.snapshot(query).buffers.pendingUsers).toBe(1);
		await runtime.flush();
		expect(send).toHaveBeenCalledTimes(1);
		now += 900_000;
		await runtime.flush();
		expect(send).toHaveBeenCalledTimes(2);
		expect(runtime.snapshot(query).buffers.pendingUsers).toBe(0);
	});

	it("caps user observations, rejects invalid events and reclaims clean users", async () => {
		let now = Date.UTC(2026, 8, 23);
		const runtime = new MemoryRuntime({ now: () => now, send: confirm });
		for (const id of [0, -1, NaN, Infinity, 1.5]) {
			runtime.recordView(id);
			runtime.recordActivity(id);
		}
		runtime.recordActivity(1, 0);
		expect(runtime.snapshot(query).buffers.pendingUsers).toBe(0);
		for (let id = 1; id <= 4097; id++) runtime.recordActivity(id);
		expect(runtime.snapshot(query).buffers).toMatchObject({
			pendingUsers: 4096,
			droppedActivities: 1,
		});
		await runtime.flush();
		runtime.recordActivity(5000);
		expect(runtime.snapshot(query).buffers.pendingUsers).toBe(1);
		now += 86_400_000;
		expect(runtime.snapshot(query).buffers).toMatchObject({
			pendingUsers: 0,
			droppedActivities: 2,
		});
	});

	it("counts retained in-flight users toward the fixed activity bound", async () => {
		const blocked = deferred<StatisticsBatchResult>();
		const secondStarted = deferred<void>();
		const send = vi.fn(async (body: StatisticsBatchRequest) => {
			if (send.mock.calls.length === 2) {
				secondStarted.resolve();
				return blocked.promise;
			}
			return confirm(body);
		});
		const runtime = new MemoryRuntime({ send });
		for (let id = 1; id <= 4096; id++) runtime.recordActivity(id);
		const flushing = runtime.flush();
		await secondStarted.promise;
		for (let id = 5000; id < 5256; id++) runtime.recordActivity(id);
		expect(runtime.snapshot(query).buffers.droppedActivities).toBe(256);
		blocked.resolve(await confirm(send.mock.calls[1][0]));
		await flushing;
		runtime.recordActivity(5000);
		expect(runtime.snapshot(query).buffers.pendingUsers).toBe(1);
	});

	it("drops uncertain activity observations without retaining unlimited retries", async () => {
		const runtime = new MemoryRuntime({
			send: async () => {
				throw new Error("offline");
			},
		});
		runtime.recordActivity(1);
		await runtime.flush();
		expect(runtime.snapshot(query).buffers).toMatchObject({
			pendingUsers: 0,
			droppedActivities: 1,
		});
	});

	it("starts one timer and retains at most sixty samples", async () => {
		vi.useFakeTimers();
		const send = vi.fn(confirm);
		const runtime = new MemoryRuntime({ send });
		runtime.start();
		runtime.start();
		expect(vi.getTimerCount()).toBe(1);
		runtime.recordView(1);
		await vi.advanceTimersByTimeAsync(61 * 60_000);
		expect(send).toHaveBeenCalledTimes(1);
		expect(runtime.snapshot(query).history).toHaveLength(60);
		runtime.stop();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("restart discards pending work and reloads the authoritative base", async () => {
		const old = new MemoryRuntime();
		old.recordView(1);
		await old.read("thread-count", "1", async () => 2);
		const restarted = new MemoryRuntime();
		expect(restarted.id).not.toBe(old.id);
		expect(restarted.snapshot(query).buffers.pendingViews).toBe(0);
		expect(await restarted.read("thread-count", "1", async () => 3)).toBe(3);
	});
});

describe("statistics transport", () => {
	it("uses only the dedicated secret and validates the response", async () => {
		vi.stubEnv("WORKER_API_URL", "http://127.0.0.1:8787");
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "test-statistics-only");
		const fetcher = vi.fn(async (_url: unknown, options: RequestInit) =>
			Response.json({ data: await confirm(JSON.parse(options.body as string)) }),
		);
		vi.stubGlobal("fetch", fetcher);
		const runtime = new MemoryRuntime();
		runtime.recordView(1);
		await runtime.flush();
		expect(fetcher.mock.calls[0][1]).toMatchObject({
			redirect: "error",
			cache: "no-store",
			headers: { "X-Ellie-Statistics-Key": "test-statistics-only" },
		});
		expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("X-API-Key");
		expect(runtime.snapshot(query).buffers.unconfirmedViews).toBe(0);
	});

	it.each([503, 200])("does not trust missing or invalid accounting at HTTP %s", async (status) => {
		vi.stubEnv("WORKER_API_URL", "http://127.0.0.1:8787");
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "key");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: {} }, { status })),
		);
		const runtime = new MemoryRuntime();
		runtime.recordView(1);
		await runtime.flush();
		expect(runtime.snapshot(query).buffers.unconfirmedViews).toBe(1);
	});

	it("fails closed without writer configuration", async () => {
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "");
		const runtime = new MemoryRuntime();
		runtime.recordView(1);
		await runtime.flush();
		expect(runtime.snapshot(query).buffers.unconfirmedViews).toBe(1);
	});

	it("bounds streamed JSON and releases the body reader", async () => {
		const source = new Response(' {"total": 1} ');
		expect(await readBoundedJson(source, 100)).toEqual({ total: 1 });
		expect(source.body?.locked).toBe(false);
		const oversized = new Response("x".repeat(100));
		await expect(readBoundedJson(oversized, 10)).rejects.toThrow("Body too large");
		expect(oversized.body?.locked).toBe(false);
		await expect(readBoundedJson(new Response(null), 10)).rejects.toThrow("Missing body");
	});
});

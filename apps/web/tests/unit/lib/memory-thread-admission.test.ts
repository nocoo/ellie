import { afterEach, expect, it, vi } from "vitest";
import { MemoryRuntime } from "@/lib/memory-runtime";

const query = { page: 1, limit: 100, family: "thread-detail" as const };
afterEach(() => vi.useRealTimers());

it("keeps at most 100 topics and replaces a topic's previous page", () => {
	const cache = new MemoryRuntime();
	for (let id = 1; id <= 101; id++) {
		expect(
			cache.admit(`thread:${id}`, { selection: "first" }, cache.capture("thread-detail")),
		).toBe(true);
	}
	expect(cache.snapshot(query).pagination.total).toBe(100);
	expect(cache.peek("thread-detail", "thread:1")).toBeUndefined();
	for (let page = 1; page <= 100; page++) {
		cache.admit("thread:101", { selection: page }, cache.capture("thread-detail"));
	}
	expect(cache.snapshot(query).pagination.total).toBe(100);
	expect(cache.peek("thread-detail", "thread:101")).toEqual({ selection: 100 });
});

it("bounds retained bytes without evicting other families or exposing cached content in previews", () => {
	const cache = new MemoryRuntime();
	cache.admit("forum:1:member", 22, cache.capture("thread-count"));
	for (let id = 1; id <= 100; id++) {
		cache.admit(
			`thread:${id}`,
			{ display: { content: "secret".repeat(30_000) } },
			cache.capture("thread-detail"),
		);
	}
	const snapshot = cache.snapshot(query);
	expect(snapshot.pagination.total).toBeLessThan(100);
	expect(
		snapshot.entries.reduce((total, entry) => total + entry.estimatedBytes, 0),
	).toBeLessThanOrEqual(4 * 1024 * 1024);
	expect(snapshot.entries.every((entry) => !entry.preview.includes("secret"))).toBe(true);
	expect(cache.peek("thread-count", "forum:1:member")).toBe(22);
	expect(cache.admit("thread:999", "x".repeat(256 * 1024), cache.capture("thread-detail"))).toBe(
		false,
	);
});

it("actively removes idle expired topics on the minute timer without extending them on a hit", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(Date.UTC(2026, 8, 24, 1));
	const cache = new MemoryRuntime();
	const empty = new MemoryRuntime();
	cache.start();
	empty.start();
	try {
		cache.admit("thread:1", 1, cache.capture("thread-detail"));
		await vi.advanceTimersByTimeAsync(29 * 60_000);
		expect(cache.peek("thread-detail", "thread:1")).toBe(1);
		await vi.advanceTimersByTimeAsync(60_000);
		const history = cache.snapshot(query).history;
		expect(history.at(-1)?.estimatedPayloadBytes).toBe(
			empty.snapshot(query).history.at(-1)?.estimatedPayloadBytes,
		);
		expect(cache.peek("thread-detail", "thread:1")).toBeUndefined();
	} finally {
		cache.stop();
		empty.stop();
	}
});

it("caps thread and count snapshots at Shanghai midnight", () => {
	let now = Date.UTC(2026, 8, 24, 15, 59);
	const cache = new MemoryRuntime({ now: () => now });
	const token = cache.capture("thread-detail");
	cache.admit("thread:1", 1, token);
	cache.admit("forum:1:member", 9, cache.capture("thread-count"));
	now += 60_000;
	expect(cache.peek("thread-detail", "thread:1")).toBeUndefined();
	expect(cache.peek("thread-count", "forum:1:member")).toBeUndefined();
	expect(cache.admit("thread:1", 2, token)).toBe(false);
});

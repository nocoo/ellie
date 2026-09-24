import { describe, expect, it } from "vitest";
import { MemoryRuntime } from "@/lib/memory-runtime";

describe("home snapshot admission", () => {
	it("fences empty, targeted and all-family clears before an actual-bucket fill", () => {
		const cache = new MemoryRuntime();
		for (const clear of [
			() => cache.clear("home-display"),
			() => cache.clear("home-display", "bucket:admin"),
			() => cache.clear(),
		]) {
			const token = cache.capture("home-display");
			clear();
			expect(cache.admit("bucket:member", { forums: [1] }, token)).toBe(false);
			expect(cache.peek("home-display", "bucket:member")).toBeUndefined();
		}
	});

	it("isolates values and bounds lifetime without extending it on hits", () => {
		let now = Date.UTC(2026, 8, 24, 1);
		const cache = new MemoryRuntime({ now: () => now });
		const token = cache.capture("home-display");
		const data = { forums: [1] };
		expect(cache.admit("bucket:member", data, token)).toBe(true);
		data.forums.push(2);
		now += 20 * 60_000;
		const hit = cache.peek<typeof data>("home-display", "bucket:member");
		expect(hit).toEqual({ forums: [1] });
		hit?.forums.push(3);
		expect(cache.peek("home-display", "bucket:member")).toEqual({ forums: [1] });
		now += 10 * 60_000;
		expect(cache.peek("home-display", "bucket:member")).toBeUndefined();
		expect(cache.admit("bucket:member", data, token)).toBe(false);
	});

	it("expires at Shanghai midnight and refuses a crossing fill or foreign instance", () => {
		let now = Date.UTC(2026, 8, 24, 15, 59);
		const cache = new MemoryRuntime({ now: () => now });
		const token = cache.capture("home-display");
		expect(cache.admit("bucket:member", 1, token)).toBe(true);
		expect(new MemoryRuntime().admit("bucket:member", 2, token)).toBe(false);
		now += 60_000;
		expect(cache.peek("home-display", "bucket:member")).toBeUndefined();
		expect(cache.admit("bucket:member", 2, token)).toBe(false);
	});

	it("enforces entry and key bounds and does not overwrite a newer response", () => {
		let now = Date.UTC(2026, 8, 24, 1);
		const cache = new MemoryRuntime({ now: () => now });
		const old = cache.capture("home-display");
		now++;
		expect(cache.admit("bucket:member", 2, cache.capture("home-display"))).toBe(true);
		expect(cache.admit("bucket:member", 1, old)).toBe(false);
		expect(cache.admit("large", "x".repeat(512 * 1024), old)).toBe(false);
		expect(cache.admit("x".repeat(257), 1, old)).toBe(false);
		expect(cache.peek("home-display", "bucket:member")).toBe(2);
	});
});

import type { MemoryCacheOverview } from "@ellie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	entryPages,
	fetchMemoryOverview,
	formatTimestamp,
	formatUptime,
	historyChartRows,
	hitRateLabel,
	instanceChanged,
	MEMORY_FAMILY_LABELS,
	MemoryCacheRequestError,
	mutateMemoryCache,
	payloadShareLabel,
	remainingMs,
} from "@/viewmodels/admin/memory-cache";

describe("memory-cache viewmodel helpers", () => {
	it("labels every managed family including forum-list", () => {
		expect(MEMORY_FAMILY_LABELS["home-display"]).toBe("首页展示");
		expect(MEMORY_FAMILY_LABELS["forum-read"]).toBe("版块读取快照");
		expect(MEMORY_FAMILY_LABELS["forum-summary"]).toBe("版块摘要");
		expect(MEMORY_FAMILY_LABELS["forum-list"]).toBe("版块列表");
		expect(Object.keys(MEMORY_FAMILY_LABELS).sort()).toEqual([
			"forum-list",
			"forum-read",
			"forum-summary",
			"home-display",
			"thread-detail",
		]);
	});
	it("formats uptime across units and rejects non-finite values", () => {
		expect(formatUptime(45_000)).toBe("45 秒");
		expect(formatUptime(5 * 60_000)).toBe("5 分钟");
		expect(formatUptime(90 * 60_000)).toBe("1 小时 30 分");
		expect(formatUptime(26 * 3_600_000)).toBe("1 天 2 小时");
		expect(formatUptime(Number.NaN)).toBe("—");
		expect(formatUptime(-1)).toBe("—");
	});

	it("formats nullable timestamps and hides invalid ones", () => {
		expect(formatTimestamp(null)).toBe("—");
		expect(formatTimestamp(undefined)).toBe("—");
		expect(formatTimestamp("2026-09-23T09:00:00.000Z")).not.toBe("—");
		expect(formatTimestamp("not-a-date")).toBe("—");
	});

	it("computes hit rate without inventing a denominator", () => {
		expect(hitRateLabel(0, 0)).toBe("—");
		expect(hitRateLabel(3, 1)).toBe("75%");
		expect(hitRateLabel(1, 2)).toBe("33.3%");
	});

	it("computes remaining TTL, page counts, and instance change safely", () => {
		expect(remainingMs("2026-09-23T09:06:00.000Z", Date.parse("2026-09-23T09:05:00.000Z"))).toBe(
			60_000,
		);
		expect(remainingMs("bogus")).toBeNull();
		expect(entryPages(0, 50)).toBe(1);
		expect(entryPages(101, 50)).toBe(3);
		expect(instanceChanged(null, { id: "a" })).toBe(false);
		expect(instanceChanged({ id: "a" }, { id: "a" })).toBe(false);
		expect(instanceChanged({ id: "a" }, { id: "b" })).toBe(true);
	});

	it("derives chart rows sorted by time and drops invalid samples", () => {
		const rows = historyChartRows([
			{ at: "2026-09-23T09:02:00.000Z", estimatedPayloadBytes: 20, pendingViews: 4 },
			{ at: "2026-09-23T09:01:00.000Z", estimatedPayloadBytes: 10, pendingViews: 2 },
			{ at: "bogus", estimatedPayloadBytes: 99, pendingViews: 99 },
		]);
		expect(rows.map((r) => r.payloadBytes)).toEqual([10, 20]);
		expect(rows[0].pendingViews).toBe(2);
	});

	it("labels payload share only against a positive limit", () => {
		const overview = {
			memory: { estimatedPayloadBytes: 1024, payloadLimitBytes: 8192 },
		} as unknown as MemoryCacheOverview;
		expect(payloadShareLabel(overview)).toBe("12.5%");
		const broken = {
			memory: { estimatedPayloadBytes: 1, payloadLimitBytes: 0 },
		} as unknown as MemoryCacheOverview;
		expect(payloadShareLabel(broken)).toBe("—");
	});
});

describe("memory-cache transport", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("builds the overview query string with optional family", async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { instance: { id: "x" } } }), { status: 200 }),
			),
		);
		globalThis.fetch = fetchMock as never;
		await fetchMemoryOverview({ page: 2, limit: 100 });
		await fetchMemoryOverview({ family: "forum-summary", page: 1, limit: 50 });
		expect(fetchMock.mock.calls[0][0]).toBe(
			"http://localhost/api/admin/memory-cache?page=2&limit=100",
		);
		expect(fetchMock.mock.calls[1][0]).toBe(
			"http://localhost/api/admin/memory-cache?page=1&limit=50&family=forum-summary",
		);
		const inits = fetchMock.mock.calls.map((call) => call[1] as RequestInit);
		expect(inits.every((init) => init.cache === "no-store" && init.method === "GET")).toBe(true);
	});

	it("surfaces contract error codes as typed errors", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: { code: "INSTANCE_CONFLICT", message: "Memory cache instance changed" },
				}),
				{ status: 409 },
			),
		) as never;
		await expect(mutateMemoryCache({ instanceId: "old", action: "flush" })).rejects.toMatchObject({
			code: "INSTANCE_CONFLICT",
			message: "Memory cache instance changed",
		});
	});

	it("falls back to UPSTREAM_UNAVAILABLE for network failures and garbage bodies", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as never;
		await expect(fetchMemoryOverview({ page: 1, limit: 50 })).rejects.toBeInstanceOf(
			MemoryCacheRequestError,
		);
		await expect(fetchMemoryOverview({ page: 1, limit: 50 })).rejects.toMatchObject({
			code: "UPSTREAM_UNAVAILABLE",
		});

		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response("not json", { status: 500 })) as never;
		await expect(fetchMemoryOverview({ page: 1, limit: 50 })).rejects.toMatchObject({
			code: "UPSTREAM_UNAVAILABLE",
		});
	});

	it("posts mutations as JSON", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
		globalThis.fetch = fetchMock as never;
		await mutateMemoryCache({ instanceId: "web-1", action: "clear", family: "forum-read" });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost/api/admin/memory-cache");
		expect(init.method).toBe("POST");
		expect(init.body).toBe(
			JSON.stringify({ instanceId: "web-1", action: "clear", family: "forum-read" }),
		);
	});
});

// Analytics collector unit tests (P3, contract only).
//
// These tests pin three things:
//
//   1. `parseBotClass` correctly buckets common UA strings, with search
//      bots winning over generic bots, and empty/missing UA → unknown.
//   2. `recordPageView` aggregates by the canonical primary key, sums
//      count, takes min for firstSeenAt and max for lastSeenAt across
//      duplicate samples — independent of arrival order.
//   3. `scheduleFlush` is idempotent within `FLUSH_INTERVAL_MS` (only
//      one `waitUntil` per window), drains the bucket via the active
//      sink, and — crucially for P3 — the DEFAULT sink is a no-op so
//      P3 does NOT persist samples anywhere. The D1 sink lands later;
//      this assertion is the contract boundary the reviewer asked for.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_internal,
	parseBotClass,
	pendingBucketSize,
	recordPageView,
	resetFlushSink,
	resetFlushThrottle,
	scheduleFlush,
	setFlushSink,
	swapBuckets,
} from "../../../../src/lib/analytics/collect";
import type { AggregateRow, PageViewSample, PathKind } from "../../../../src/lib/analytics/types";
import type { Env } from "../../../../src/lib/env";

function makeSample(overrides: Partial<PageViewSample> = {}): PageViewSample {
	return {
		dateLocal: "2026-05-20",
		pathKind: "thread",
		targetId: 12345,
		userId: 0,
		botClass: "human",
		ts: 1_747_700_000,
		...overrides,
	};
}

function mockEnv(): Env {
	// The collector default sink never reads env; we only need a
	// stable identity for the assertion that the sink received it.
	return { ENVIRONMENT: "test" } as unknown as Env;
}

function mockCtx(): { ctx: ExecutionContext; tasks: Promise<unknown>[] } {
	const tasks: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (p: Promise<unknown>) => {
			tasks.push(p);
		},
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;
	return { ctx, tasks };
}

// Each test starts from a clean accumulator + default sink + reset
// throttle so cases never bleed into each other. The collector is an
// in-isolate module — without explicit reset it remembers across tests.
beforeEach(() => {
	swapBuckets();
	resetFlushSink();
	resetFlushThrottle();
});

afterEach(() => {
	swapBuckets();
	resetFlushSink();
	resetFlushThrottle();
	vi.restoreAllMocks();
});

describe("parseBotClass", () => {
	it("returns unknown for null / undefined / empty / whitespace UA", () => {
		expect(parseBotClass(null)).toBe("unknown");
		expect(parseBotClass(undefined)).toBe("unknown");
		expect(parseBotClass("")).toBe("unknown");
		expect(parseBotClass("   ")).toBe("unknown");
	});

	it("classifies common search engine crawlers as bot_search", () => {
		expect(
			parseBotClass("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
		).toBe("bot_search");
		expect(
			parseBotClass("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
		).toBe("bot_search");
		expect(
			parseBotClass(
				"Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
			),
		).toBe("bot_search");
		expect(parseBotClass("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)")).toBe(
			"bot_search",
		);
		expect(
			parseBotClass("Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)"),
		).toBe("bot_search");
	});

	it("classifies generic automation/crawler UAs as bot_other", () => {
		expect(parseBotClass("curl/7.85.0")).toBe("bot_other");
		expect(parseBotClass("Wget/1.21.3")).toBe("bot_other");
		expect(parseBotClass("python-requests/2.31.0")).toBe("bot_other");
		expect(
			parseBotClass("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"),
		).toBe("bot_other");
		expect(
			parseBotClass(
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/118.0.0.0 Safari/537.36",
			),
		).toBe("bot_other");
		// Generic "bot" / "spider" tokens not anchored to a known search engine.
		expect(parseBotClass("SomeUnknownBot/1.0")).toBe("bot_other");
		expect(parseBotClass("MysterySpider")).toBe("bot_other");
	});

	it("classifies browser-shaped UAs as human", () => {
		expect(
			parseBotClass(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			),
		).toBe("human");
		expect(
			parseBotClass(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
			),
		).toBe("human");
		expect(
			parseBotClass(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
			),
		).toBe("human");
	});

	it("search-engine match wins over the generic bot/spider token", () => {
		// Googlebot UA also contains the substring "bot" — without
		// search-first ordering we'd classify it as bot_other.
		expect(
			parseBotClass("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
		).toBe("bot_search");
	});
});

describe("recordPageView", () => {
	it("starts with an empty bucket", () => {
		expect(pendingBucketSize()).toBe(0);
		expect(swapBuckets()).toEqual([]);
	});

	it("accumulates count and tracks min/max ts for the same key", () => {
		recordPageView(makeSample({ ts: 1000 }));
		recordPageView(makeSample({ ts: 2000 }));
		recordPageView(makeSample({ ts: 500 })); // earliest
		recordPageView(makeSample({ ts: 1500 }));

		expect(pendingBucketSize()).toBe(1);

		const rows = swapBuckets();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject<AggregateRow>({
			dateLocal: "2026-05-20",
			pathKind: "thread",
			targetId: 12345,
			userId: 0,
			botClass: "human",
			count: 4,
			firstSeenAt: 500,
			lastSeenAt: 2000,
		});
	});

	it("keeps distinct buckets for distinct primary keys", () => {
		// 5 different primary key dimensions × at least one differing
		// per pair → bucket separately.
		recordPageView(makeSample({ dateLocal: "2026-05-20", targetId: 1 }));
		recordPageView(makeSample({ dateLocal: "2026-05-21", targetId: 1 })); // date differs
		recordPageView(makeSample({ pathKind: "forum", targetId: 1 })); // pathKind differs
		recordPageView(makeSample({ pathKind: "thread", targetId: 2 })); // targetId differs
		recordPageView(makeSample({ userId: 7 })); // userId differs
		recordPageView(makeSample({ botClass: "bot_search" })); // botClass differs

		expect(pendingBucketSize()).toBe(6);
		const rows = swapBuckets();
		expect(rows).toHaveLength(6);
		for (const row of rows) {
			expect(row.count).toBe(1);
		}
	});

	it("drains the bucket on swap and starts fresh for new samples", () => {
		recordPageView(makeSample({ ts: 100 }));
		recordPageView(makeSample({ ts: 200 }));
		expect(pendingBucketSize()).toBe(1);
		const first = swapBuckets();
		expect(first[0].count).toBe(2);
		expect(pendingBucketSize()).toBe(0);

		recordPageView(makeSample({ ts: 300 }));
		const second = swapBuckets();
		expect(second).toHaveLength(1);
		expect(second[0].count).toBe(1);
		expect(second[0].firstSeenAt).toBe(300);
		expect(second[0].lastSeenAt).toBe(300);
	});

	it("buckets samples on either side of Asia/Shanghai midnight separately", () => {
		// The dateLocal field is resolved by the ingest route, not the
		// collector — but the collector must treat dateLocal as part of
		// the primary key so a single ingest window straddling midnight
		// produces two rows, not one row with mixed days.
		recordPageView(makeSample({ dateLocal: "2026-05-20", ts: 1_747_785_590 }));
		recordPageView(makeSample({ dateLocal: "2026-05-21", ts: 1_747_785_610 }));
		const rows = swapBuckets();
		expect(rows).toHaveLength(2);
		const days = rows.map((r) => r.dateLocal).sort();
		expect(days).toEqual(["2026-05-20", "2026-05-21"]);
		for (const row of rows) {
			expect(row.count).toBe(1);
		}
	});

	it("accepts every PathKind defined by the v3 proxy plan", () => {
		// Regression guard: P5 (ingest) maps the Next middleware
		// matcher one-to-one onto these buckets. If a future PR narrows
		// PathKind, every path the proxy plan already named must still
		// have a non-`other` home — otherwise login/register traffic
		// silently leaks into content visit metrics. The list below is
		// the v3 plan's canonical set (msg=ccdac0cf).
		const v3Kinds: PathKind[] = [
			"thread",
			"forum",
			"user",
			"home",
			"digest",
			"search",
			"checkin",
			"messages",
			"auth_page",
			"other",
		];
		for (let i = 0; i < v3Kinds.length; i++) {
			recordPageView(makeSample({ pathKind: v3Kinds[i], targetId: i }));
		}
		expect(pendingBucketSize()).toBe(v3Kinds.length);
		const rows = swapBuckets();
		const seen = new Set(rows.map((r) => r.pathKind));
		for (const kind of v3Kinds) {
			expect(seen.has(kind)).toBe(true);
		}
	});

	it("auth_page is a SEPARATE bucket from content visits", () => {
		// Reviewer pin (msg=ccdac0cf): `/login` / `/register` must NOT
		// be mixed into forum-engagement metrics. The contract enforces
		// this by giving auth_page its own PathKind; the collector then
		// keys aggregation on pathKind so an auth_page sample and a
		// home sample for the same user never collapse into one row.
		recordPageView(makeSample({ pathKind: "auth_page", userId: 42 }));
		recordPageView(makeSample({ pathKind: "home", userId: 42 }));
		const rows = swapBuckets();
		expect(rows).toHaveLength(2);
		const kinds = rows.map((r) => r.pathKind).sort();
		expect(kinds).toEqual(["auth_page", "home"]);
	});
});

describe("scheduleFlush", () => {
	it("is a no-op when the bucket is empty", () => {
		const { ctx, tasks } = mockCtx();
		scheduleFlush(mockEnv(), ctx);
		expect(tasks).toHaveLength(0);
	});

	it("schedules exactly one waitUntil per throttle window even on repeated calls", async () => {
		const sink = vi.fn(async () => {});
		setFlushSink(sink);

		recordPageView(makeSample());
		const { ctx, tasks } = mockCtx();
		scheduleFlush(mockEnv(), ctx);
		scheduleFlush(mockEnv(), ctx);
		scheduleFlush(mockEnv(), ctx);

		expect(tasks).toHaveLength(1);
		await Promise.all(tasks);
		expect(sink).toHaveBeenCalledTimes(1);
	});

	it("drains the bucket and passes the snapshot to the active sink", async () => {
		const captured: AggregateRow[][] = [];
		setFlushSink(async (_env, rows) => {
			captured.push(rows);
		});

		recordPageView(makeSample({ ts: 1000 }));
		recordPageView(makeSample({ ts: 2000 }));
		recordPageView(makeSample({ pathKind: "forum", targetId: 99 }));

		const { ctx, tasks } = mockCtx();
		scheduleFlush(mockEnv(), ctx);
		await Promise.all(tasks);

		expect(captured).toHaveLength(1);
		expect(captured[0]).toHaveLength(2);
		const byKind = Object.fromEntries(captured[0].map((r) => [r.pathKind, r]));
		expect(byKind.thread.count).toBe(2);
		expect(byKind.thread.firstSeenAt).toBe(1000);
		expect(byKind.thread.lastSeenAt).toBe(2000);
		expect(byKind.forum.count).toBe(1);

		// After flush the live bucket is empty.
		expect(pendingBucketSize()).toBe(0);
	});

	it("after a flush the next scheduleFlush within the window is a no-op", async () => {
		const sink = vi.fn(async () => {});
		setFlushSink(sink);

		recordPageView(makeSample());
		const { ctx, tasks } = mockCtx();
		scheduleFlush(mockEnv(), ctx);
		await Promise.all(tasks);

		// Add a new sample after the flush. The throttle should still
		// be engaged, so a second scheduleFlush within FLUSH_INTERVAL_MS
		// must NOT drain.
		recordPageView(makeSample());
		const { ctx: ctx2, tasks: tasks2 } = mockCtx();
		scheduleFlush(mockEnv(), ctx2);
		expect(tasks2).toHaveLength(0);
		// The bucket still holds the new sample.
		expect(pendingBucketSize()).toBe(1);

		// resetFlushThrottle simulates passing the 30s window — without
		// it, the next call would also be throttled.
		resetFlushThrottle();
		const { ctx: ctx3, tasks: tasks3 } = mockCtx();
		scheduleFlush(mockEnv(), ctx3);
		expect(tasks3).toHaveLength(1);
		await Promise.all(tasks3);
		expect(sink).toHaveBeenCalledTimes(2);
	});

	it("catches and swallows sink failures so they never reach the request hot path", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		setFlushSink(async () => {
			throw new Error("simulated sink failure");
		});

		recordPageView(makeSample());
		const { ctx, tasks } = mockCtx();
		scheduleFlush(mockEnv(), ctx);
		// The scheduled task settles without throwing.
		await expect(Promise.all(tasks)).resolves.toBeDefined();
		expect(warn).toHaveBeenCalled();
		// The bucket was still drained (swap happens before the sink is invoked).
		expect(pendingBucketSize()).toBe(0);
	});

	it("default sink is a no-op — P3 contract boundary, no D1 write", async () => {
		// This is the boundary the reviewer pinned: P3 must NOT persist
		// samples anywhere. The default sink drains but does not write.
		// The D1 sink lands in a later phase with the
		// analytics_daily_targets migration.
		expect(_internal.NOOP_SINK).toBeDefined();
		await expect(_internal.NOOP_SINK(mockEnv(), [])).resolves.toBeUndefined();

		recordPageView(makeSample());
		recordPageView(makeSample({ pathKind: "forum", targetId: 42 }));
		expect(pendingBucketSize()).toBe(2);

		const { ctx, tasks } = mockCtx();
		// No setFlushSink — use the default NOOP_SINK.
		scheduleFlush(mockEnv(), ctx);
		await Promise.all(tasks);

		// Drained, but nothing was written by the default sink.
		expect(pendingBucketSize()).toBe(0);
	});

	it("FLUSH_INTERVAL_MS is 30s — matches kv-metrics flush cadence", () => {
		expect(_internal.FLUSH_INTERVAL_MS).toBe(30_000);
	});
});

describe("_internal.bucketKey / parseBucketKey", () => {
	it("round-trips a sample through key encode + decode", () => {
		const s = makeSample({
			dateLocal: "2026-05-20",
			pathKind: "user",
			targetId: 777,
			userId: 1234,
			botClass: "bot_search",
		});
		const key = _internal.bucketKey(s);
		const head = _internal.parseBucketKey(key);
		expect(head).toEqual({
			dateLocal: "2026-05-20",
			pathKind: "user",
			targetId: 777,
			userId: 1234,
			botClass: "bot_search",
		});
	});

	it("parseBucketKey returns null on malformed keys", () => {
		expect(_internal.parseBucketKey("garbage")).toBeNull();
		expect(_internal.parseBucketKey("a\x01b\x01c\x01d\x01e\x01f")).toBeNull();
		// targetId non-numeric.
		expect(_internal.parseBucketKey("2026-05-20\x01thread\x01abc\x010\x01human")).toBeNull();
	});
});

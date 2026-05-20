import {
	ANALYTICS_RANGES,
	ANALYTICS_TREND_METRICS,
	METRIC_LABELS,
	RANGE_LABELS,
	parseCheckinTrend,
	parseForumDist,
	parseLoginAttemptList,
	parseLoginAttemptReveal,
	parseOverview,
	parseTodayLoginsKpi,
	parseTrend,
} from "@/viewmodels/admin/analytics";
import { describe, expect, it } from "vitest";

describe("analytics viewmodel", () => {
	describe("constants", () => {
		it("exposes the supported ranges", () => {
			expect(ANALYTICS_RANGES).toEqual(["7d", "30d", "90d"]);
		});

		it("exposes the supported trend metrics", () => {
			expect(ANALYTICS_TREND_METRICS).toEqual(["users", "threads", "posts", "checkins"]);
		});

		it("has Chinese labels for every metric", () => {
			for (const m of ANALYTICS_TREND_METRICS) {
				expect(METRIC_LABELS[m]).toBeTruthy();
			}
		});

		it("has Chinese labels for every range", () => {
			for (const r of ANALYTICS_RANGES) {
				expect(RANGE_LABELS[r]).toBeTruthy();
			}
		});
	});

	describe("parseOverview", () => {
		it("parses a complete payload", () => {
			const raw = {
				now: 1_700_000_000,
				today: { newUsers: 5, newThreads: 7, newPosts: 23, checkins: 12 },
			};
			const result = parseOverview(raw);
			expect(result.now).toBe(1_700_000_000);
			expect(result.today.newUsers).toBe(5);
			expect(result.today.newThreads).toBe(7);
			expect(result.today.newPosts).toBe(23);
			expect(result.today.checkins).toBe(12);
		});

		it("defaults missing today fields to zero", () => {
			const result = parseOverview({ now: 1, today: { newUsers: 5 } });
			expect(result.today.newUsers).toBe(5);
			expect(result.today.newThreads).toBe(0);
			expect(result.today.newPosts).toBe(0);
			expect(result.today.checkins).toBe(0);
		});

		it("handles null input", () => {
			const result = parseOverview(null);
			expect(result.now).toBe(0);
			expect(result.today.newUsers).toBe(0);
			expect(result.today.checkins).toBe(0);
		});

		it("handles undefined input", () => {
			const result = parseOverview(undefined);
			expect(result.now).toBe(0);
			expect(result.today.newPosts).toBe(0);
		});

		it("coerces non-finite/string values to zero", () => {
			const result = parseOverview({
				now: Number.NaN,
				today: {
					newUsers: "5" as unknown as number,
					newThreads: Number.POSITIVE_INFINITY,
					newPosts: null as unknown as number,
					checkins: undefined as unknown as number,
				},
			});
			expect(result.now).toBe(0);
			expect(result.today.newUsers).toBe(0);
			// Infinity is not finite per Number.isFinite -> fallback 0
			expect(result.today.newThreads).toBe(0);
			expect(result.today.newPosts).toBe(0);
			expect(result.today.checkins).toBe(0);
		});
	});

	describe("parseTrend", () => {
		it("parses a complete payload and preserves point order", () => {
			const raw = {
				metric: "threads",
				range: "30d",
				series: [
					{ date: "2026-05-01", count: 3 },
					{ date: "2026-05-02", count: 7 },
				],
			};
			const result = parseTrend(raw, "users", "7d");
			expect(result.metric).toBe("threads");
			expect(result.range).toBe("30d");
			expect(result.series).toEqual([
				{ date: "2026-05-01", count: 3 },
				{ date: "2026-05-02", count: 7 },
			]);
		});

		it("falls back to caller defaults when metric/range are unknown", () => {
			const result = parseTrend({ metric: "bogus", range: "999d", series: [] }, "posts", "90d");
			expect(result.metric).toBe("posts");
			expect(result.range).toBe("90d");
		});

		it("returns empty series when series is missing or not an array", () => {
			expect(parseTrend({ metric: "users", range: "7d" }, "users", "7d").series).toEqual([]);
			expect(
				parseTrend({ metric: "users", range: "7d", series: "nope" }, "users", "7d").series,
			).toEqual([]);
		});

		it("defaults missing series point fields to safe zero/empty string", () => {
			const raw = {
				metric: "users",
				range: "7d",
				series: [{}, { date: "2026-05-03" }, { count: 9 }],
			};
			const result = parseTrend(raw, "users", "7d");
			expect(result.series).toEqual([
				{ date: "", count: 0 },
				{ date: "2026-05-03", count: 0 },
				{ date: "", count: 9 },
			]);
		});

		it("handles null and undefined input", () => {
			const a = parseTrend(null, "users", "7d");
			expect(a.metric).toBe("users");
			expect(a.range).toBe("7d");
			expect(a.series).toEqual([]);

			const b = parseTrend(undefined, "checkins", "90d");
			expect(b.metric).toBe("checkins");
			expect(b.range).toBe("90d");
		});
	});

	describe("parseForumDist", () => {
		it("parses a complete payload", () => {
			const raw = {
				range: "30d",
				rows: [
					{ forumId: 1, forumName: "灌水", posts: 42 },
					{ forumId: 2, forumName: "技术", posts: 17 },
				],
			};
			const result = parseForumDist(raw, "7d");
			expect(result.range).toBe("30d");
			expect(result.rows).toHaveLength(2);
			expect(result.rows[0]).toEqual({ forumId: 1, forumName: "灌水", posts: 42 });
		});

		it("falls back to caller range when unknown", () => {
			const result = parseForumDist({ range: "bogus", rows: [] }, "30d");
			expect(result.range).toBe("30d");
		});

		it("returns empty rows when missing or not an array", () => {
			expect(parseForumDist({ range: "7d" }, "7d").rows).toEqual([]);
			expect(parseForumDist({ range: "7d", rows: "nope" }, "7d").rows).toEqual([]);
		});

		it("defaults missing row fields", () => {
			const raw = { range: "7d", rows: [{}, { forumName: "X" }, { forumId: 3, posts: 5 }] };
			const result = parseForumDist(raw, "7d");
			expect(result.rows).toEqual([
				{ forumId: 0, forumName: "", posts: 0 },
				{ forumId: 0, forumName: "X", posts: 0 },
				{ forumId: 3, forumName: "", posts: 5 },
			]);
		});

		it("handles null and undefined input", () => {
			expect(parseForumDist(null, "7d")).toEqual({ range: "7d", rows: [] });
			expect(parseForumDist(undefined, "90d")).toEqual({ range: "90d", rows: [] });
		});
	});

	describe("parseCheckinTrend", () => {
		it("parses a complete payload", () => {
			const raw = {
				range: "7d",
				series: [
					{ date: "2026-05-01", count: 10 },
					{ date: "2026-05-02", count: 15 },
				],
			};
			const result = parseCheckinTrend(raw, "30d");
			expect(result.range).toBe("7d");
			expect(result.series).toEqual([
				{ date: "2026-05-01", count: 10 },
				{ date: "2026-05-02", count: 15 },
			]);
		});

		it("falls back to caller range when unknown", () => {
			const result = parseCheckinTrend({ range: "bogus" }, "90d");
			expect(result.range).toBe("90d");
		});

		it("returns empty series when missing or not an array", () => {
			expect(parseCheckinTrend({ range: "7d" }, "7d").series).toEqual([]);
			expect(parseCheckinTrend({ range: "7d", series: 42 }, "7d").series).toEqual([]);
		});

		it("handles null and undefined input", () => {
			expect(parseCheckinTrend(null, "7d")).toEqual({ range: "7d", series: [] });
			expect(parseCheckinTrend(undefined, "30d")).toEqual({ range: "30d", series: [] });
		});
	});

	describe("parseTodayLoginsKpi", () => {
		it("parses a complete payload", () => {
			const raw = {
				now: 1_700_000_000,
				dayStart: 1_699_900_000,
				totalAttempts: 42,
				successAttempts: 30,
				failedAttempts: 12,
				uniqueUsers: 25,
				uniqueIps: 18,
				loginAttempts: 35,
				registerAttempts: 7,
			};
			const result = parseTodayLoginsKpi(raw);
			expect(result.totalAttempts).toBe(42);
			expect(result.successAttempts).toBe(30);
			expect(result.failedAttempts).toBe(12);
			expect(result.uniqueUsers).toBe(25);
			expect(result.uniqueIps).toBe(18);
			expect(result.loginAttempts).toBe(35);
			expect(result.registerAttempts).toBe(7);
			expect(result.now).toBe(1_700_000_000);
			expect(result.dayStart).toBe(1_699_900_000);
		});

		it("defaults missing fields to zero", () => {
			const result = parseTodayLoginsKpi({});
			expect(result.totalAttempts).toBe(0);
			expect(result.successAttempts).toBe(0);
			expect(result.failedAttempts).toBe(0);
			expect(result.uniqueUsers).toBe(0);
			expect(result.uniqueIps).toBe(0);
			expect(result.loginAttempts).toBe(0);
			expect(result.registerAttempts).toBe(0);
		});

		it("handles null and undefined input", () => {
			expect(parseTodayLoginsKpi(null).totalAttempts).toBe(0);
			expect(parseTodayLoginsKpi(undefined).totalAttempts).toBe(0);
		});

		it("coerces non-finite values to zero", () => {
			const result = parseTodayLoginsKpi({
				now: Number.NaN,
				totalAttempts: Number.POSITIVE_INFINITY,
				successAttempts: "30" as unknown as number,
			});
			expect(result.now).toBe(0);
			expect(result.totalAttempts).toBe(0);
			expect(result.successAttempts).toBe(0);
		});
	});

	describe("parseLoginAttemptList", () => {
		it("parses a complete payload with masked rows", () => {
			const raw = {
				page: 1,
				limit: 20,
				total: 2,
				rows: [
					{
						id: 100,
						userId: 7,
						username: "alice",
						ok: 1,
						kind: "login",
						errorCode: "",
						ipMasked: "1.2.x.x",
						botClass: "human",
						createdAt: 1000,
					},
					{
						id: 99,
						userId: null,
						username: "bob",
						ok: 0,
						kind: "login",
						errorCode: "INVALID_CREDENTIALS",
						ipMasked: "2001:db8::x",
						botClass: "ua-bot",
						createdAt: 999,
					},
				],
			};
			const result = parseLoginAttemptList(raw);
			expect(result.page).toBe(1);
			expect(result.limit).toBe(20);
			expect(result.total).toBe(2);
			expect(result.rows).toHaveLength(2);
			expect(result.rows[0].ipMasked).toBe("1.2.x.x");
			expect(result.rows[0].ok).toBe(1);
			expect(result.rows[1].userId).toBeNull();
			expect(result.rows[1].ok).toBe(0);
		});

		it("defaults page/limit/total to safe values when missing", () => {
			const result = parseLoginAttemptList({});
			expect(result.page).toBe(1);
			expect(result.limit).toBe(20);
			expect(result.total).toBe(0);
			expect(result.rows).toEqual([]);
		});

		it("handles non-array rows", () => {
			expect(parseLoginAttemptList({ rows: "nope" }).rows).toEqual([]);
		});

		it("handles null and undefined input", () => {
			expect(parseLoginAttemptList(null).rows).toEqual([]);
			expect(parseLoginAttemptList(undefined).rows).toEqual([]);
		});

		it("coerces ok to 0/1 only", () => {
			const result = parseLoginAttemptList({
				rows: [
					{ id: 1, ok: 99 }, // invalid → fallback 0
					{ id: 2, ok: 1 },
					{ id: 3, ok: "yes" as unknown as number }, // string → asNumber → 0
				],
			});
			expect(result.rows[0].ok).toBe(0);
			expect(result.rows[1].ok).toBe(1);
			expect(result.rows[2].ok).toBe(0);
		});

		it("preserves non-finite userId as null", () => {
			const result = parseLoginAttemptList({
				rows: [
					{ id: 1, userId: Number.NaN },
					{ id: 2, userId: "5" as unknown as number },
				],
			});
			expect(result.rows[0].userId).toBeNull();
			expect(result.rows[1].userId).toBeNull();
		});
	});

	describe("parseLoginAttemptReveal", () => {
		it("parses a complete payload including raw ip/ua/username", () => {
			const raw = {
				id: 42,
				userId: 7,
				username: "alice",
				ok: 0,
				kind: "login",
				errorCode: "INVALID_CREDENTIALS",
				ip: "203.0.113.45",
				userAgent: "Mozilla/5.0",
				botClass: "human",
				createdAt: 1700,
			};
			const result = parseLoginAttemptReveal(raw);
			expect(result.id).toBe(42);
			expect(result.userId).toBe(7);
			expect(result.username).toBe("alice");
			expect(result.ok).toBe(0);
			expect(result.errorCode).toBe("INVALID_CREDENTIALS");
			expect(result.ip).toBe("203.0.113.45");
			expect(result.userAgent).toBe("Mozilla/5.0");
		});

		it("defaults missing fields to safe empties", () => {
			const result = parseLoginAttemptReveal({});
			expect(result.id).toBe(0);
			expect(result.userId).toBeNull();
			expect(result.username).toBe("");
			expect(result.ok).toBe(0);
			expect(result.ip).toBe("");
			expect(result.userAgent).toBe("");
		});

		it("handles null and undefined input", () => {
			expect(parseLoginAttemptReveal(null).ip).toBe("");
			expect(parseLoginAttemptReveal(undefined).userAgent).toBe("");
		});

		it("coerces ok=1 only when strictly 1", () => {
			expect(parseLoginAttemptReveal({ ok: 1 }).ok).toBe(1);
			expect(parseLoginAttemptReveal({ ok: 2 }).ok).toBe(0);
			expect(parseLoginAttemptReveal({ ok: 0 }).ok).toBe(0);
		});
	});
});

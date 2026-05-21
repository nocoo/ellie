import {
	ANALYTICS_RANGES,
	ANALYTICS_TREND_METRICS,
	METRIC_LABELS,
	PATH_KIND_LABELS,
	PATH_KIND_VALUES,
	RANGE_LABELS,
	isPathKind,
	parseCheckinTrend,
	parseForumDist,
	parseLoginAttemptList,
	parseLoginAttemptReveal,
	parseOverview,
	parseTodayLoginsKpi,
	parseTodayVisitsKpi,
	parseTodayVisitsList,
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

	describe("PATH_KIND_VALUES + isPathKind", () => {
		it("freezes the 10-bucket whitelist mirroring the worker enum", () => {
			expect([...PATH_KIND_VALUES]).toEqual([
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
			]);
		});

		it("has a Chinese label for every bucket", () => {
			for (const pk of PATH_KIND_VALUES) {
				expect(PATH_KIND_LABELS[pk]).toBeTruthy();
			}
		});

		it("rejects unknown / non-string values", () => {
			expect(isPathKind("thread")).toBe(true);
			expect(isPathKind("forum")).toBe(true);
			expect(isPathKind("other")).toBe(true);
			expect(isPathKind("nope")).toBe(false);
			expect(isPathKind("")).toBe(false);
			expect(isPathKind(null)).toBe(false);
			expect(isPathKind(undefined)).toBe(false);
			expect(isPathKind(7)).toBe(false);
		});
	});

	describe("parseTodayVisitsKpi", () => {
		it("parses a complete payload", () => {
			const raw = {
				now: 1_700_000_000,
				dateLocal: "2026-05-20",
				totalViews: 1234,
				humanViews: 1000,
				botSearchViews: 150,
				botOtherViews: 50,
				unknownViews: 34,
				distinctTargets: 87,
				activeUsers: 25,
				anonPresent: 1,
				byPathKind: [
					{ pathKind: "thread", views: 800, targets: 60 },
					{ pathKind: "forum", views: 234, targets: 12 },
					{ pathKind: "home", views: 200, targets: 1 },
				],
			};
			const result = parseTodayVisitsKpi(raw);
			expect(result.dateLocal).toBe("2026-05-20");
			expect(result.totalViews).toBe(1234);
			expect(result.activeUsers).toBe(25);
			expect(result.anonPresent).toBe(1);
			expect(result.byPathKind).toHaveLength(3);
			expect(result.byPathKind[0]).toEqual({ pathKind: "thread", views: 800, targets: 60 });
		});

		it("defaults missing fields to safe empties", () => {
			const result = parseTodayVisitsKpi({});
			expect(result.now).toBe(0);
			expect(result.dateLocal).toBe("");
			expect(result.totalViews).toBe(0);
			expect(result.humanViews).toBe(0);
			expect(result.botSearchViews).toBe(0);
			expect(result.botOtherViews).toBe(0);
			expect(result.unknownViews).toBe(0);
			expect(result.distinctTargets).toBe(0);
			expect(result.activeUsers).toBe(0);
			expect(result.anonPresent).toBe(0);
			expect(result.byPathKind).toEqual([]);
		});

		it("coerces anonPresent to strictly 0/1", () => {
			expect(parseTodayVisitsKpi({ anonPresent: 1 }).anonPresent).toBe(1);
			expect(parseTodayVisitsKpi({ anonPresent: 0 }).anonPresent).toBe(0);
			expect(parseTodayVisitsKpi({ anonPresent: 2 }).anonPresent).toBe(0);
			expect(parseTodayVisitsKpi({ anonPresent: true as unknown as number }).anonPresent).toBe(0);
		});

		it("drops byPathKind entries with unknown pathKind", () => {
			const result = parseTodayVisitsKpi({
				byPathKind: [
					{ pathKind: "thread", views: 1, targets: 1 },
					{ pathKind: "bogus", views: 999, targets: 999 },
					{ pathKind: "user", views: 2, targets: 2 },
				],
			});
			expect(result.byPathKind).toEqual([
				{ pathKind: "thread", views: 1, targets: 1 },
				{ pathKind: "user", views: 2, targets: 2 },
			]);
		});

		it("handles null and undefined input", () => {
			expect(parseTodayVisitsKpi(null).totalViews).toBe(0);
			expect(parseTodayVisitsKpi(undefined).byPathKind).toEqual([]);
		});
	});

	describe("parseTodayVisitsList", () => {
		it("parses a complete payload preserving row order", () => {
			const raw = {
				page: 2,
				limit: 20,
				total: 42,
				rows: [
					{
						pathKind: "thread",
						targetId: 7,
						label: "Hello",
						views: 100,
						humanViews: 80,
						botSearchViews: 12,
						botOtherViews: 5,
						unknownViews: 3,
						uniqueUsers: 25,
						firstSeenAt: 1000,
						lastSeenAt: 2000,
					},
					{
						pathKind: "home",
						targetId: 0,
						label: "",
						views: 200,
						humanViews: 180,
						botSearchViews: 10,
						botOtherViews: 5,
						unknownViews: 5,
						uniqueUsers: 50,
						firstSeenAt: 900,
						lastSeenAt: 1900,
					},
				],
			};
			const result = parseTodayVisitsList(raw);
			expect(result.page).toBe(2);
			expect(result.limit).toBe(20);
			expect(result.total).toBe(42);
			expect(result.rows).toHaveLength(2);
			expect(result.rows[0].pathKind).toBe("thread");
			expect(result.rows[0].label).toBe("Hello");
			expect(result.rows[1].pathKind).toBe("home");
		});

		it("defaults missing page/limit to safe values", () => {
			const result = parseTodayVisitsList({});
			expect(result.page).toBe(1);
			expect(result.limit).toBe(20);
			expect(result.total).toBe(0);
			expect(result.rows).toEqual([]);
		});

		it("drops rows with unknown pathKind", () => {
			const result = parseTodayVisitsList({
				rows: [
					{ pathKind: "thread", targetId: 1 },
					{ pathKind: "bogus", targetId: 99 },
					{ pathKind: "user", targetId: 2 },
				],
			});
			expect(result.rows).toHaveLength(2);
			expect(result.rows.map((r) => r.pathKind)).toEqual(["thread", "user"]);
		});

		it("coerces missing numeric / string fields to safe zero/empty", () => {
			const result = parseTodayVisitsList({
				rows: [{ pathKind: "thread" }],
			});
			expect(result.rows[0]).toEqual({
				pathKind: "thread",
				targetId: 0,
				label: "",
				views: 0,
				humanViews: 0,
				botSearchViews: 0,
				botOtherViews: 0,
				unknownViews: 0,
				uniqueUsers: 0,
				firstSeenAt: 0,
				lastSeenAt: 0,
			});
		});

		it("handles non-array rows / null / undefined", () => {
			expect(parseTodayVisitsList({ rows: "nope" }).rows).toEqual([]);
			expect(parseTodayVisitsList(null).rows).toEqual([]);
			expect(parseTodayVisitsList(undefined).rows).toEqual([]);
		});
	});
});

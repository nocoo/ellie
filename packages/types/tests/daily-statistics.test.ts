import { describe, expect, it, vi } from "vitest";
import {
	applyDailyStatisticsDelta,
	DAILY_STATISTICS_MAX_FORUMS,
	DAILY_STATISTICS_MAX_TYPES,
	type DailyStatistics,
	dailyStatisticsForDay,
	EMPTY_HOME_STATS,
	isDailyStatistics,
	statisticsDay,
} from "../src/daily-statistics";

const now = Date.parse("2026-09-25T02:00:00Z");
function snapshot(): DailyStatistics {
	return {
		version: `${now}-00000000-0000-0000-0000-000000000000`,
		generatedAt: now,
		day: "2026-09-25",
		stats: {
			...EMPTY_HOME_STATS,
			todayPosts: 10,
			yesterdayPosts: 20,
			totalThreads: 50,
			totalPosts: 90,
		},
		forums: { "1": { threads: 20, posts: 40, todayThreads: 3, types: { "2": 10 } } },
	};
}

describe("daily statistics transport", () => {
	it("validates complete counters and rejects malformed persistent data", () => {
		expect(isDailyStatistics(snapshot())).toBe(true);
		for (const value of [
			null,
			[],
			{},
			{ ...snapshot(), version: "broken" },
			{ ...snapshot(), generatedAt: -1 },
			{ ...snapshot(), day: "yesterday" },
			{ ...snapshot(), stats: { ...EMPTY_HOME_STATS, totalPosts: -1 } },
			{ ...snapshot(), stats: {} },
			{ ...snapshot(), forums: JSON.parse('{"__proto__":{}}') },
			{ ...snapshot(), forums: { bad: snapshot().forums[1] } },
			{ ...snapshot(), forums: { "1": { ...snapshot().forums[1], types: { "2": -1 } } } },
			{ ...snapshot(), forums: { "1": { ...snapshot().forums[1], types: { bad: 1 } } } },
			{ ...snapshot(), forums: { "1": { ...snapshot().forums[1], types: null } } },
			{ ...snapshot(), forums: { "1": { ...snapshot().forums[1], threads: Number.NaN } } },
			{ ...snapshot(), forums: [] },
			{ ...snapshot(), stats: { ...EMPTY_HOME_STATS, peakDate: "too long for a date" } },
			{
				...snapshot(),
				forums: Object.fromEntries(
					Array.from({ length: DAILY_STATISTICS_MAX_FORUMS + 1 }, (_, id) => [
						id + 1,
						snapshot().forums[1],
					]),
				),
			},
			{
				...snapshot(),
				forums: {
					"1": {
						...snapshot().forums[1],
						types: Object.fromEntries(
							Array.from({ length: DAILY_STATISTICS_MAX_TYPES + 1 }, (_, id) => [id, 0]),
						),
					},
				},
			},
		])
			expect(isDailyStatistics(value)).toBe(false);
	});

	it("resets date buckets at Shanghai midnight without losing cumulative counts", () => {
		const original = snapshot();
		expect(dailyStatisticsForDay(original, now)).toBe(original);
		const next = dailyStatisticsForDay(original, Date.parse("2026-09-25T16:00:00Z"));
		expect(next.day).toBe("2026-09-26");
		expect(next.stats).toMatchObject({ todayPosts: 0, yesterdayPosts: 10, totalPosts: 90 });
		expect(next.forums[1]).toMatchObject({ threads: 20, todayThreads: 0 });
		expect(dailyStatisticsForDay(original, now + 2 * 86_400_000).stats.yesterdayPosts).toBe(0);
		expect(original.stats.todayPosts).toBe(10);
		expect(statisticsDay(Date.parse("2026-09-25T15:59:59Z"))).toBe("2026-09-25");
	});

	it("applies committed thread, reply and membership increments without mutating a shared snapshot", () => {
		const original = snapshot();
		const thread = applyDailyStatisticsDelta(
			original,
			{ kind: "thread", forumId: 1, typeId: 2 },
			now,
		);
		expect(thread.stats).toMatchObject({ totalThreads: 51, totalPosts: 91, todayPosts: 11 });
		expect(thread.forums[1]).toEqual({
			threads: 21,
			posts: 41,
			todayThreads: 4,
			types: { "2": 11 },
		});
		const post = applyDailyStatisticsDelta(thread, { kind: "post", forumId: 1 }, now);
		expect(post.forums[1]).toEqual({ ...thread.forums[1], posts: 42 });
		const member = applyDailyStatisticsDelta(post, { kind: "member" }, now);
		expect(member.stats.totalMembers).toBe(1);
		expect(member.stats.totalPosts).toBe(92);
		expect(original.forums[1].types[2]).toBe(10);
	});

	it("handles new forums, absent types and absent forum context", () => {
		const original = snapshot();
		expect(
			applyDailyStatisticsDelta(original, { kind: "thread", forumId: 2 }, now).forums[2],
		).toEqual({ threads: 1, posts: 1, todayThreads: 1, types: { "0": 1 } });
		for (const forumId of [undefined, 0, -1, Number.NaN]) {
			expect(applyDailyStatisticsDelta(original, { kind: "post", forumId }, now).forums).toEqual(
				original.forums,
			);
		}
		expect(
			applyDailyStatisticsDelta(original, { kind: "thread", forumId: 1, typeId: -1 }, now).forums[1]
				.types,
		).toEqual({ "2": 10 });
		vi.spyOn(Date, "now").mockReturnValue(now);
		expect(statisticsDay()).toBe("2026-09-25");
		expect(dailyStatisticsForDay(original)).toBe(original);
		expect(applyDailyStatisticsDelta(original, { kind: "member" }).stats.totalMembers).toBe(1);
		vi.restoreAllMocks();
	});
});

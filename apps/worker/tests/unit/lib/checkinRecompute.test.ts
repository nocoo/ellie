// checkinRecompute.test.ts — Phase E. Locks the source-of-truth contract
// for `recomputeFromHistory`: history-empty preservation vs. allowEmptyReset,
// streak walker semantics, month_days slicing, last_checkin_at = max(created_at).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeFromHistory } from "../../../src/lib/checkinRecompute";
import { createMockDb, makeEnv } from "../../helpers";

// Pin Date so today=2026-05-12 (Shanghai), yesterday=2026-05-11.
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-05-12T04:30:00Z"));
});
afterEach(() => {
	vi.useRealTimers();
});

const TODAY = "2026-05-12";
const YESTERDAY = "2026-05-11";
const TWO_DAYS_AGO = "2026-05-10";
const LAST_MONTH = "2026-04-30";

function row(date: string, reward = 0, createdAt = 1715486400) {
	return { date_local: date, reward, created_at: createdAt };
}

describe("recomputeFromHistory — empty history", () => {
	it("default: returns skipped=true and does NOT touch user_checkins", async () => {
		const { db, calls } = createMockDb({
			allResults: { "FROM checkin_history WHERE user_id": [] },
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42);
		expect(result.skipped).toBe(true);
		expect(result.totalDays).toBe(0);
		const writeCall = calls.find((c) => c.sql.includes("INTO user_checkins"));
		expect(writeCall).toBeUndefined();
	});

	it("allowEmptyReset=true: zeroes the aggregate row", async () => {
		const { db, calls } = createMockDb({
			allResults: { "FROM checkin_history WHERE user_id": [] },
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42, { allowEmptyReset: true });
		expect(result.skipped).toBe(false);
		expect(result.totalDays).toBe(0);
		expect(result.streakDays).toBe(0);
		const writeCall = calls.find(
			(c) => c.sql.includes("INSERT INTO user_checkins") && c.sql.includes("DO UPDATE SET"),
		);
		expect(writeCall).toBeDefined();
	});
});

describe("recomputeFromHistory — non-empty history", () => {
	it("counts total_days, sums reward_total, picks max(created_at)", async () => {
		const { db, calls } = createMockDb({
			allResults: {
				"FROM checkin_history WHERE user_id": [
					row(TWO_DAYS_AGO, 50, 1000),
					row(YESTERDAY, 100, 2000),
					row(TODAY, 200, 3000),
				],
			},
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42);
		expect(result.totalDays).toBe(3);
		expect(result.rewardTotal).toBe(350);
		expect(result.lastCheckinAt).toBe(3000);
		expect(result.streakDays).toBe(3); // today, yesterday, two-days-ago all adjacent

		const writeCall = calls.find((c) => c.sql.includes("INSERT INTO user_checkins"));
		expect(writeCall?.params).toEqual([42, 3, 3, 3, 350, 3000]);
	});

	it("month_days only counts rows in the current Shanghai month", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM checkin_history WHERE user_id": [
					row(LAST_MONTH, 0, 1000), // April → not counted
					row(TODAY, 0, 2000), // May
					row(YESTERDAY, 0, 1500), // May
				],
			},
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42);
		expect(result.totalDays).toBe(3);
		expect(result.monthDays).toBe(2);
	});

	it("streak=0 when latest row is older than yesterday", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM checkin_history WHERE user_id": [
					row("2026-05-09", 0, 1000),
					row("2026-05-08", 0, 900),
				],
			},
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42);
		expect(result.totalDays).toBe(2);
		expect(result.streakDays).toBe(0);
	});

	it("streak counts from yesterday when latest row is yesterday", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM checkin_history WHERE user_id": [row(YESTERDAY, 0, 2000), row(TWO_DAYS_AGO, 0, 1000)],
			},
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42);
		expect(result.streakDays).toBe(2);
	});

	it("streak stops at the first gap going backward", async () => {
		const { db } = createMockDb({
			allResults: {
				"FROM checkin_history WHERE user_id": [
					row(TODAY, 0, 3000),
					row(YESTERDAY, 0, 2000),
					// gap on 2026-05-10
					row("2026-05-09", 0, 1000),
				],
			},
		});
		const env = makeEnv({ DB: db });
		const result = await recomputeFromHistory(env, 42);
		expect(result.streakDays).toBe(2); // today + yesterday only
	});
});

import {
	CHECKIN_HOUR_END_EXCLUSIVE,
	CHECKIN_HOUR_START,
	CHECKIN_LEVELS,
	CHECKIN_MOODS,
	CHECKIN_REWARD_MAX,
	CHECKIN_REWARD_MIN,
	CHECKIN_TIMEZONE,
	getCheckinLevel,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// getCheckinLevel — the only logic in checkin.ts. Tier resolution is a simple
// linear scan over CHECKIN_LEVELS, but its boundary behavior is contractual:
// returns the highest tier whose `minDays` is <= totalDays, or null below 1.
// We exercise both branches of the loop conditional plus every tier boundary.
// ---------------------------------------------------------------------------

describe("getCheckinLevel — boundary contract", () => {
	it("returns null when totalDays is below the first tier (0)", () => {
		expect(getCheckinLevel(0)).toBeNull();
	});

	it("returns null for negative totalDays", () => {
		expect(getCheckinLevel(-1)).toBeNull();
	});

	it("returns the first tier exactly at minDays = 1", () => {
		const tier = getCheckinLevel(1);
		expect(tier).toEqual(CHECKIN_LEVELS[0]);
	});

	it("returns the highest tier when totalDays exceeds the last threshold", () => {
		// 1500 is the last tier; an input far above it must still resolve there.
		const last = CHECKIN_LEVELS[CHECKIN_LEVELS.length - 1];
		expect(getCheckinLevel(10_000)).toEqual(last);
	});

	it("returns the previous tier just before the next threshold", () => {
		// minDays of tier index 1 is 3 → 2 must still map to tier 0.
		expect(getCheckinLevel(2)).toEqual(CHECKIN_LEVELS[0]);
	});

	it.each(CHECKIN_LEVELS.map((tier, idx) => [idx, tier] as const))(
		"resolves exactly at the lower boundary of tier %i",
		(_idx, tier) => {
			expect(getCheckinLevel(tier.minDays)).toEqual(tier);
		},
	);

	it.each(CHECKIN_LEVELS.slice(0, -1).map((tier, idx) => [idx, tier] as const))(
		"resolves to tier %i one day before the next tier's lower boundary",
		(idx, tier) => {
			const next = CHECKIN_LEVELS[idx + 1];
			expect(getCheckinLevel(next.minDays - 1)).toEqual(tier);
		},
	);
});

// ---------------------------------------------------------------------------
// Constants and lookup tables. These don't have logic but the documented
// shape is part of the public contract — locking them down catches accidental
// edits to the migration-0033 mapping.
// ---------------------------------------------------------------------------

describe("CHECKIN_MOODS", () => {
	it("includes the 9 dsu_paulsign moods with non-empty Chinese labels", () => {
		const keys = Object.keys(CHECKIN_MOODS);
		expect(keys).toEqual(["kx", "ng", "ym", "wl", "nu", "ch", "fd", "yl", "shuai"]);
		for (const k of keys) {
			expect(CHECKIN_MOODS[k as keyof typeof CHECKIN_MOODS]).toMatch(/.+/);
		}
	});
});

describe("CHECKIN_LEVELS", () => {
	it("is strictly ascending by minDays and by level", () => {
		for (let i = 1; i < CHECKIN_LEVELS.length; i++) {
			expect(CHECKIN_LEVELS[i].minDays).toBeGreaterThan(CHECKIN_LEVELS[i - 1].minDays);
			expect(CHECKIN_LEVELS[i].level).toBeGreaterThan(CHECKIN_LEVELS[i - 1].level);
		}
	});

	it("starts at level 1 with minDays 1 and ends at level 11 with minDays 1500", () => {
		expect(CHECKIN_LEVELS[0]).toMatchObject({ level: 1, minDays: 1 });
		const last = CHECKIN_LEVELS[CHECKIN_LEVELS.length - 1];
		expect(last).toMatchObject({ level: 11, minDays: 1500 });
	});
});

describe("Reward + window constants", () => {
	it("reward range: MIN <= MAX and both > 0", () => {
		expect(CHECKIN_REWARD_MIN).toBeGreaterThan(0);
		expect(CHECKIN_REWARD_MAX).toBeGreaterThanOrEqual(CHECKIN_REWARD_MIN);
	});

	it("check-in window is half-open and within a single day", () => {
		expect(CHECKIN_HOUR_START).toBeGreaterThanOrEqual(0);
		expect(CHECKIN_HOUR_END_EXCLUSIVE).toBeGreaterThan(CHECKIN_HOUR_START);
		expect(CHECKIN_HOUR_END_EXCLUSIVE).toBeLessThanOrEqual(24);
	});

	it("timezone is the canonical IANA name", () => {
		expect(CHECKIN_TIMEZONE).toBe("Asia/Shanghai");
	});
});

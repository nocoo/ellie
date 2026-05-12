// shanghaiTime.test.ts — Boundary-locking tests for the shared
// Asia/Shanghai date primitives. The public POST /api/v1/checkin handler
// AND the admin checkin endpoints (Phase E) both consume these helpers,
// so a regression here breaks the per-day uniqueness contract on
// `checkin_history`.
//
// In particular we lock:
//   - getShanghaiParts shifts UTC into Shanghai (+8) on day boundaries
//   - shanghaiDateLocal returns canonical YYYY-MM-DD for the
//     `checkin_history.date_local` column
//   - shanghaiTodayStartUnix returns 00:00:00 Shanghai as unix seconds
//   - isWithinCheckinWindow gates [04:00, 23:00) Shanghai
//   - isValidShanghaiDateLocal rejects junk before it reaches D1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getShanghaiParts,
	isValidShanghaiDateLocal,
	isWithinCheckinWindow,
	shanghaiDateLocal,
	shanghaiNoonUnix,
	shanghaiPrevDay,
	shanghaiTodayStartUnix,
} from "../../../src/lib/shanghaiTime";

/** Pin Date to a fixed UTC instant so Shanghai math is deterministic. */
function setUtc(iso: string): void {
	vi.setSystemTime(new Date(iso));
}

describe("shanghaiTime — getShanghaiParts", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("shifts UTC midday into Shanghai +8", () => {
		setUtc("2026-05-12T04:30:00Z"); // 12:30 Shanghai
		const p = getShanghaiParts();
		expect(p).toEqual({ year: 2026, month: 5, day: 12, hour: 12 });
	});

	it("crosses to next Shanghai day when UTC is late evening", () => {
		setUtc("2026-05-11T16:30:00Z"); // 00:30 Shanghai on the 12th
		const p = getShanghaiParts();
		expect(p.year).toBe(2026);
		expect(p.month).toBe(5);
		expect(p.day).toBe(12);
		expect(p.hour).toBe(0);
	});

	it("normalizes Intl hour=24 (midnight) back to 0", () => {
		setUtc("2026-05-11T16:00:00Z"); // exactly 00:00 Shanghai on the 12th
		const p = getShanghaiParts();
		expect(p.hour).toBe(0);
		expect(p.day).toBe(12);
	});

	it("accepts an explicit Date argument", () => {
		const explicit = new Date("2026-05-12T15:59:59Z"); // 23:59:59 Shanghai
		const p = getShanghaiParts(explicit);
		expect(p).toEqual({ year: 2026, month: 5, day: 12, hour: 23 });
	});
});

describe("shanghaiTime — shanghaiDateLocal", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("formats Shanghai date as zero-padded YYYY-MM-DD", () => {
		setUtc("2026-01-05T04:00:00Z"); // 12:00 Shanghai 2026-01-05
		expect(shanghaiDateLocal()).toBe("2026-01-05");
	});

	it("rolls over to next Shanghai day at +8h boundary", () => {
		setUtc("2026-05-11T16:00:00Z"); // exactly 00:00 Shanghai on the 12th
		expect(shanghaiDateLocal()).toBe("2026-05-12");
	});

	it("stays on prior Shanghai day for late UTC same day", () => {
		setUtc("2026-05-11T15:59:59Z"); // 23:59:59 Shanghai on the 11th
		expect(shanghaiDateLocal()).toBe("2026-05-11");
	});

	it("formats from explicit Date", () => {
		const d = new Date("2026-12-31T16:30:00Z"); // 00:30 Shanghai 2027-01-01
		expect(shanghaiDateLocal(d)).toBe("2027-01-01");
	});
});

describe("shanghaiTime — shanghaiTodayStartUnix", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("returns 00:00 Shanghai as unix seconds (= UTC 16:00 prior day)", () => {
		setUtc("2026-05-12T04:30:00Z"); // 12:30 Shanghai
		// 00:00 Shanghai 2026-05-12 = 16:00 UTC 2026-05-11
		const expected = Math.floor(Date.UTC(2026, 4, 11, 16, 0, 0) / 1000);
		expect(shanghaiTodayStartUnix()).toBe(expected);
	});
});

describe("shanghaiTime — isWithinCheckinWindow", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("rejects 03:59 Shanghai (before window)", () => {
		setUtc("2026-05-11T19:59:00Z"); // 03:59 Shanghai 2026-05-12
		expect(isWithinCheckinWindow()).toBe(false);
	});

	it("accepts 04:00 Shanghai (start inclusive)", () => {
		setUtc("2026-05-11T20:00:00Z"); // 04:00 Shanghai 2026-05-12
		expect(isWithinCheckinWindow()).toBe(true);
	});

	it("accepts 22:59 Shanghai (just before end)", () => {
		setUtc("2026-05-12T14:59:00Z"); // 22:59 Shanghai 2026-05-12
		expect(isWithinCheckinWindow()).toBe(true);
	});

	it("rejects 23:00 Shanghai (end exclusive)", () => {
		setUtc("2026-05-12T15:00:00Z"); // 23:00 Shanghai 2026-05-12
		expect(isWithinCheckinWindow()).toBe(false);
	});
});

describe("shanghaiTime — isValidShanghaiDateLocal", () => {
	it("accepts canonical YYYY-MM-DD", () => {
		expect(isValidShanghaiDateLocal("2026-05-12")).toBe(true);
		expect(isValidShanghaiDateLocal("2026-01-01")).toBe(true);
		expect(isValidShanghaiDateLocal("2026-12-31")).toBe(true);
	});

	it("rejects non-string input", () => {
		expect(isValidShanghaiDateLocal(20260512)).toBe(false);
		expect(isValidShanghaiDateLocal(null)).toBe(false);
		expect(isValidShanghaiDateLocal(undefined)).toBe(false);
		expect(isValidShanghaiDateLocal({})).toBe(false);
	});

	it("rejects malformed strings", () => {
		expect(isValidShanghaiDateLocal("2026-5-12")).toBe(false); // not zero-padded
		expect(isValidShanghaiDateLocal("2026/05/12")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-05-12T00:00:00")).toBe(false);
		expect(isValidShanghaiDateLocal("")).toBe(false);
	});

	it("rejects out-of-range month/day/year", () => {
		expect(isValidShanghaiDateLocal("2026-13-01")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-00-15")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-05-32")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-05-00")).toBe(false);
		expect(isValidShanghaiDateLocal("1999-05-12")).toBe(false);
		expect(isValidShanghaiDateLocal("2101-05-12")).toBe(false);
	});

	it("rejects impossible calendar days (real-calendar guard)", () => {
		// Reviewer ask: 2026-02-31 must 400, not silently accepted.
		// Without the round-trip guard the recompute can't reproduce it
		// from any real calendar walk, leaving aggregates desynced.
		expect(isValidShanghaiDateLocal("2026-02-31")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-02-30")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-02-29")).toBe(false); // not a leap year
		expect(isValidShanghaiDateLocal("2026-04-31")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-06-31")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-09-31")).toBe(false);
		expect(isValidShanghaiDateLocal("2026-11-31")).toBe(false);
	});

	it("accepts leap-day in actual leap years", () => {
		expect(isValidShanghaiDateLocal("2024-02-29")).toBe(true);
		expect(isValidShanghaiDateLocal("2028-02-29")).toBe(true);
	});
});

describe("shanghaiTime — shanghaiNoonUnix", () => {
	it("returns Shanghai 12:00 as unix seconds (= UTC 04:00 same day)", () => {
		// 2026-05-12 12:00 Shanghai = 2026-05-12 04:00 UTC
		const expected = Math.floor(Date.UTC(2026, 4, 12, 4, 0, 0) / 1000);
		expect(shanghaiNoonUnix("2026-05-12")).toBe(expected);
	});

	it("handles year boundary correctly", () => {
		const expected = Math.floor(Date.UTC(2026, 0, 1, 4, 0, 0) / 1000);
		expect(shanghaiNoonUnix("2026-01-01")).toBe(expected);
	});
});

describe("shanghaiTime — shanghaiPrevDay", () => {
	it("returns the day before in YYYY-MM-DD form", () => {
		expect(shanghaiPrevDay("2026-05-12")).toBe("2026-05-11");
	});

	it("crosses month boundary", () => {
		expect(shanghaiPrevDay("2026-05-01")).toBe("2026-04-30");
		expect(shanghaiPrevDay("2026-03-01")).toBe("2026-02-28"); // not leap
		expect(shanghaiPrevDay("2024-03-01")).toBe("2024-02-29"); // leap
	});

	it("crosses year boundary", () => {
		expect(shanghaiPrevDay("2026-01-01")).toBe("2025-12-31");
	});
});

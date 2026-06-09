import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatCompactNumber,
	formatDate,
	formatDateTime,
	formatDateTimeMobile,
	formatLocaleDate,
	formatNumber,
	formatRelativeTime,
} from "@/viewmodels/shared/formatting";

describe("formatNumber", () => {
	it("formats numbers with thousand separators", () => {
		expect(formatNumber(1234567)).toBe("1,234,567");
	});

	it("returns '0' for null", () => {
		expect(formatNumber(null)).toBe("0");
	});

	it("returns '0' for undefined", () => {
		expect(formatNumber(undefined)).toBe("0");
	});

	it("returns '0' for NaN", () => {
		expect(formatNumber(Number.NaN)).toBe("0");
	});

	it("formats zero", () => {
		expect(formatNumber(0)).toBe("0");
	});
});

describe("formatCompactNumber", () => {
	it("formats numbers >= 10000 with 万", () => {
		expect(formatCompactNumber(10000)).toBe("1.0万");
		expect(formatCompactNumber(12345)).toBe("1.2万");
	});

	it("formats numbers >= 1000 with K", () => {
		expect(formatCompactNumber(1000)).toBe("1.0K");
		expect(formatCompactNumber(1500)).toBe("1.5K");
	});

	it("formats numbers < 1000 with locale", () => {
		expect(formatCompactNumber(999)).toBe("999");
		expect(formatCompactNumber(0)).toBe("0");
	});
});

describe("formatDate", () => {
	it("returns empty string for 0", () => {
		expect(formatDate(0)).toBe("");
	});

	it("formats timestamp to date without zero-padding", () => {
		// 2003-07-14 in some timezone — just check pattern
		const result = formatDate(1058140800);
		expect(result).toMatch(/^\d{4}-\d{1,2}-\d{1,2}$/);
	});
});

describe("formatDateTime", () => {
	it("returns empty string for 0", () => {
		expect(formatDateTime(0)).toBe("");
	});

	it("formats timestamp with zero-padded time", () => {
		const result = formatDateTime(1058140800);
		expect(result).toMatch(/^\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}$/);
	});
});

describe("formatDateTimeMobile", () => {
	// Pin "now" to 2026-06-15 12:30 local time so all branch tests are
	// deterministic regardless of the actual CI calendar (reviewer freeze
	// msg=683d8fff: previous tests assumed CI never runs on Jan 1).
	const FIXED_NOW = new Date(2026, 5, 15, 12, 30, 0); // local-time June 15

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(FIXED_NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns empty string for 0", () => {
		expect(formatDateTimeMobile(0)).toBe("");
	});

	it("treats negative timestamps as zero (defence against 1969 fallback)", () => {
		// Unix epoch math turns negative seconds into pre-1970 dates. The
		// homepage feed never produces negative `lastPostAt`, but the formatter
		// has no business pretending those dates are real — return empty so
		// callers (e.g. MobileLastPostLine) trip their `<= 0` branch instead.
		expect(formatDateTimeMobile(-1)).toBe("");
		expect(formatDateTimeMobile(-1_000_000)).toBe("");
	});

	it("returns HH:mm for same-day timestamps", () => {
		// 2026-06-15 09:05 local — same day as the fixed `now`.
		const sameDay = new Date(2026, 5, 15, 9, 5, 0).getTime() / 1000;
		expect(formatDateTimeMobile(sameDay)).toBe("09:05");
	});

	it("returns MM-DD for same-year, different-day timestamps", () => {
		// 2026-01-07 noon — same year as `now`, different day.
		const sameYear = new Date(2026, 0, 7, 12, 0, 0).getTime() / 1000;
		expect(formatDateTimeMobile(sameYear)).toBe("01-07");
	});

	it("returns YYYY-MM-DD for previous-year timestamps", () => {
		// 2025-12-31 — last year relative to `now`.
		const prevYear = new Date(2025, 11, 31, 23, 59, 0).getTime() / 1000;
		expect(formatDateTimeMobile(prevYear)).toBe("2025-12-31");
	});

	it("stays at most 10 characters wide (defence vs title crowding)", () => {
		// Cap is the longest branch (YYYY-MM-DD = 10 chars).
		const prevYear = new Date(2025, 11, 31).getTime() / 1000;
		const sameYear = new Date(2026, 0, 7).getTime() / 1000;
		const sameDay = new Date(2026, 5, 15, 9, 5, 0).getTime() / 1000;
		expect(formatDateTimeMobile(prevYear).length).toBeLessThanOrEqual(10);
		expect(formatDateTimeMobile(sameYear).length).toBeLessThanOrEqual(10);
		expect(formatDateTimeMobile(sameDay).length).toBeLessThanOrEqual(10);
	});
});

describe("formatLocaleDate", () => {
	it("returns null for 0", () => {
		expect(formatLocaleDate(0)).toBeNull();
	});

	it("returns null for negative", () => {
		expect(formatLocaleDate(-1)).toBeNull();
	});

	it("returns formatted date string for valid timestamp", () => {
		const result = formatLocaleDate(1700000000);
		expect(result).not.toBeNull();
		// Should be a locale date string
		expect(result?.length).toBeGreaterThan(0);
	});
});

describe("formatRelativeTime", () => {
	it("returns empty string for 0", () => {
		expect(formatRelativeTime(0)).toBe("");
	});

	it("returns '刚刚' for < 60s ago", () => {
		const now = Math.floor(Date.now() / 1000) - 30;
		expect(formatRelativeTime(now)).toBe("刚刚");
	});

	it("returns X 分钟前 for < 1h ago", () => {
		const now = Math.floor(Date.now() / 1000) - 300; // 5 min
		expect(formatRelativeTime(now)).toContain("分钟前");
	});

	it("returns X 小时前 for < 24h ago", () => {
		const now = Math.floor(Date.now() / 1000) - 7200; // 2 hours
		expect(formatRelativeTime(now)).toContain("小时前");
	});

	it("returns X 天前 for < 30d ago", () => {
		const now = Math.floor(Date.now() / 1000) - 86400 * 5; // 5 days
		expect(formatRelativeTime(now)).toContain("天前");
	});

	it("returns locale date for > 30d ago", () => {
		const old = Math.floor(Date.now() / 1000) - 86400 * 60;
		const result = formatRelativeTime(old);
		expect(result).not.toContain("前");
		expect(result).not.toBe("");
	});
});

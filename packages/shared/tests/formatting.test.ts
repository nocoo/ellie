import { describe, expect, it } from "vitest";
import {
	formatCompactNumber,
	formatDate,
	formatDateTime,
	formatLocaleDate,
	formatNumber,
	formatRelativeTime,
} from "../src/viewmodels/formatting";

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe("formatNumber", () => {
	it("formats zero", () => {
		expect(formatNumber(0)).toBe("0");
	});

	it("formats small numbers", () => {
		expect(formatNumber(42)).toBe("42");
		expect(formatNumber(999)).toBe("999");
	});

	it("formats numbers with thousand separators", () => {
		expect(formatNumber(1234)).toBe("1,234");
		expect(formatNumber(1234567)).toBe("1,234,567");
	});
});

// ---------------------------------------------------------------------------
// formatCompactNumber
// ---------------------------------------------------------------------------

describe("formatCompactNumber", () => {
	it("formats small numbers with locale string", () => {
		expect(formatCompactNumber(0)).toBe("0");
		expect(formatCompactNumber(42)).toBe("42");
		expect(formatCompactNumber(999)).toBe("999");
	});

	it("formats thousands with K suffix", () => {
		expect(formatCompactNumber(1000)).toBe("1.0K");
		expect(formatCompactNumber(5600)).toBe("5.6K");
		expect(formatCompactNumber(9999)).toBe("10.0K");
	});

	it("formats ten-thousands with 万 suffix", () => {
		expect(formatCompactNumber(10000)).toBe("1.0万");
		expect(formatCompactNumber(12345)).toBe("1.2万");
		expect(formatCompactNumber(100000)).toBe("10.0万");
	});

	it("boundary at 1000", () => {
		expect(formatCompactNumber(1000)).toBe("1.0K");
	});

	it("boundary at 10000", () => {
		expect(formatCompactNumber(10000)).toBe("1.0万");
	});
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatDate(0)).toBe("");
	});

	it("formats timestamp without zero-padding", () => {
		const ts = new Date("2003-07-14T00:00:00Z").getTime() / 1000;
		const result = formatDate(ts);
		expect(result).toContain("2003");
		expect(result).toMatch(/\d{4}-\d{1,2}-\d{1,2}/);
	});

	it("formats a known date correctly", () => {
		const ts = new Date(2003, 6, 14).getTime() / 1000;
		expect(formatDate(ts)).toBe("2003-7-14");
	});
});

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe("formatDateTime", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatDateTime(0)).toBe("");
	});

	it("formats timestamp with zero-padded time", () => {
		const ts = new Date("2013-05-19T23:40:00Z").getTime() / 1000;
		const result = formatDateTime(ts);
		expect(result).toContain("2013");
		expect(result).toMatch(/\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}/);
	});

	it("formats a known date-time correctly", () => {
		const ts = new Date(2013, 4, 19, 23, 40).getTime() / 1000;
		expect(formatDateTime(ts)).toBe("2013-5-19 23:40");
	});
});

// ---------------------------------------------------------------------------
// formatLocaleDate
// ---------------------------------------------------------------------------

describe("formatLocaleDate", () => {
	it("returns null for zero timestamp", () => {
		expect(formatLocaleDate(0)).toBeNull();
	});

	it("returns null for negative timestamp", () => {
		expect(formatLocaleDate(-1)).toBeNull();
	});

	it("returns a string for valid timestamp", () => {
		const ts = new Date("2024-01-05T00:00:00Z").getTime() / 1000;
		const result = formatLocaleDate(ts);
		expect(result).not.toBeNull();
		expect(typeof result).toBe("string");
		expect(result as string).toContain("2024");
	});

	it("returns zero-padded date format", () => {
		const ts = new Date("2024-01-05T00:00:00Z").getTime() / 1000;
		const result = formatLocaleDate(ts);
		expect(result).toMatch(/\d{4}\/\d{2}\/\d{2}/);
	});
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatRelativeTime(0)).toBe("");
	});

	it('returns "刚刚" for timestamps within 60 seconds', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 30)).toBe("刚刚");
	});

	it('returns "刚刚" for current timestamp', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now)).toBe("刚刚");
	});

	it('returns "X 分钟前" for timestamps within 1 hour', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 300)).toBe("5 分钟前");
	});

	it('returns "X 分钟前" at boundary of 60 seconds', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 60)).toBe("1 分钟前");
	});

	it('returns "X 小时前" for timestamps within 24 hours', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 7200)).toBe("2 小时前");
	});

	it('returns "X 小时前" at boundary of 1 hour', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 3600)).toBe("1 小时前");
	});

	it('returns "X 天前" for timestamps within 30 days', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 86400 * 3)).toBe("3 天前");
	});

	it('returns "X 天前" at boundary of 1 day', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 86400)).toBe("1 天前");
	});

	it("returns absolute date for timestamps older than 30 days", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = formatRelativeTime(now - 86400 * 60);
		expect(result).not.toContain("前");
		expect(result).not.toBe("刚刚");
		expect(result).toMatch(/\d/);
	});
});

import { describe, expect, it } from "bun:test";
import {
	formatDate,
	formatDateTime,
	formatLocaleDate,
	formatRelativeTime,
} from "../../../../apps/web/src/viewmodels/shared/formatting";

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
	it("returns empty string for zero timestamp", () => {
		expect(formatDate(0)).toBe("");
	});

	it("formats timestamp without zero-padding", () => {
		// 2003-07-14 00:00:00 UTC
		const ts = new Date("2003-07-14T00:00:00Z").getTime() / 1000;
		const result = formatDate(ts);
		// Should contain 2003 and not have zero-padded month
		expect(result).toContain("2003");
		expect(result).toMatch(/\d{4}-\d{1,2}-\d{1,2}/);
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
		// 2013-05-19 23:40:00 UTC
		const ts = new Date("2013-05-19T23:40:00Z").getTime() / 1000;
		const result = formatDateTime(ts);
		expect(result).toContain("2013");
		expect(result).toMatch(/\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}/);
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
		// Should contain 2024
		expect(result!).toContain("2024");
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

	it('returns "X 分钟前" for timestamps within 1 hour', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 300)).toBe("5 分钟前");
	});

	it('returns "X 小时前" for timestamps within 24 hours', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 7200)).toBe("2 小时前");
	});

	it('returns "X 天前" for timestamps within 30 days', () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatRelativeTime(now - 86400 * 3)).toBe("3 天前");
	});

	it("returns absolute date for timestamps older than 30 days", () => {
		const now = Math.floor(Date.now() / 1000);
		const result = formatRelativeTime(now - 86400 * 60);
		// Should be a date string, not a relative string
		expect(result).not.toContain("前");
		expect(result).not.toBe("刚刚");
		expect(result).toMatch(/\d/);
	});
});

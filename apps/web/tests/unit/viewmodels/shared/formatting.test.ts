import {
	formatCompactNumber,
	formatDate,
	formatDateTime,
	formatLocaleDate,
	formatNumber,
	formatRelativeTime,
} from "@/viewmodels/shared/formatting";
import { describe, expect, it } from "vitest";

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

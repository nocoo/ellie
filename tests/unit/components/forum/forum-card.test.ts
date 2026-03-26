import { describe, expect, test } from "bun:test";
import { formatCount, formatRelativeTime } from "@/components/forum/forum-card";

describe("ForumCard", () => {
	describe("formatCount", () => {
		test("small numbers returned as-is", () => {
			expect(formatCount(0)).toBe("0");
			expect(formatCount(1)).toBe("1");
			expect(formatCount(999)).toBe("999");
		});

		test("thousands formatted with K suffix", () => {
			expect(formatCount(1000)).toBe("1.0K");
			expect(formatCount(1234)).toBe("1.2K");
			expect(formatCount(9999)).toBe("10.0K");
		});

		test("ten-thousands formatted with K suffix", () => {
			expect(formatCount(12345)).toBe("12.3K");
			expect(formatCount(100000)).toBe("100.0K");
		});
	});

	describe("formatRelativeTime", () => {
		test("returns empty string for timestamp 0", () => {
			expect(formatRelativeTime(0)).toBe("");
		});

		test("recent timestamps return 'just now'", () => {
			const now = Date.now() / 1000;
			expect(formatRelativeTime(now - 30)).toBe("just now");
		});

		test("minutes ago", () => {
			const now = Date.now() / 1000;
			expect(formatRelativeTime(now - 120)).toBe("2m ago");
			expect(formatRelativeTime(now - 3000)).toBe("50m ago");
		});

		test("hours ago", () => {
			const now = Date.now() / 1000;
			expect(formatRelativeTime(now - 7200)).toBe("2h ago");
		});

		test("days ago", () => {
			const now = Date.now() / 1000;
			expect(formatRelativeTime(now - 172800)).toBe("2d ago");
		});

		test("months ago", () => {
			const now = Date.now() / 1000;
			// 2592000s = 30 days (1 month boundary)
			expect(formatRelativeTime(now - 2592000)).toBe("1mo ago");
		});
	});

	test("ForumCard component is exported", async () => {
		const mod = await import("@/components/forum/forum-card");
		expect(mod.ForumCard).toBeDefined();
	});
});

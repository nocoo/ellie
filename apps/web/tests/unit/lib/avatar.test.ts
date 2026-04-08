import { describe, expect, test } from "bun:test";
import { getAvatarUrl } from "../../../src/lib/avatar";

describe("getAvatarUrl", () => {
	test("returns proxy URL for UID", () => {
		expect(getAvatarUrl(12345, "big")).toBe("/api/avatar/12345");
	});

	test("returns proxy URL without params when size is big (default)", () => {
		expect(getAvatarUrl(1, "big")).toBe("/api/avatar/1");
	});

	test("size param is deprecated and ignored - always returns same URL", () => {
		// Size param kept for backward compatibility but ignored
		expect(getAvatarUrl(42, "big")).toBe("/api/avatar/42");
		expect(getAvatarUrl(42, "middle")).toBe("/api/avatar/42");
		expect(getAvatarUrl(42, "small")).toBe("/api/avatar/42");
	});

	test("default size is 'big'", () => {
		expect(getAvatarUrl(12345)).toBe("/api/avatar/12345");
	});

	test("supports cacheBust parameter for cache busting", () => {
		const timestamp = 1712345678000;
		expect(getAvatarUrl(42, "big", timestamp)).toBe("/api/avatar/42?v=1712345678000");
	});

	test("cacheBust parameter works with any size", () => {
		const timestamp = 1234567890;
		// Size is ignored, cacheBust is applied
		expect(getAvatarUrl(99, "small", timestamp)).toBe("/api/avatar/99?v=1234567890");
		expect(getAvatarUrl(99, "middle", timestamp)).toBe("/api/avatar/99?v=1234567890");
	});

	test("no params when cacheBust is undefined", () => {
		expect(getAvatarUrl(42, "big", undefined)).toBe("/api/avatar/42");
	});
});

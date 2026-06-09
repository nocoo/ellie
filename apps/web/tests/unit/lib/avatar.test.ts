import { describe, expect, it } from "vitest";
import { getAvatarUrl } from "@/lib/avatar";

describe("getAvatarUrl", () => {
	it("returns proxy URL for UID without avatarPath", () => {
		expect(getAvatarUrl(12345, "big")).toBe("/api/avatar/12345");
	});

	it("returns proxy URL without params when size is big (default)", () => {
		expect(getAvatarUrl(1, "big")).toBe("/api/avatar/1");
	});

	it("size param is deprecated and ignored - always returns same URL", () => {
		// Size param kept for backward compatibility but ignored
		expect(getAvatarUrl(42, "big")).toBe("/api/avatar/42");
		expect(getAvatarUrl(42, "middle")).toBe("/api/avatar/42");
		expect(getAvatarUrl(42, "small")).toBe("/api/avatar/42");
	});

	it("default size is 'big'", () => {
		expect(getAvatarUrl(12345)).toBe("/api/avatar/12345");
	});

	it("returns direct CDN URL when avatarPath is provided", () => {
		expect(getAvatarUrl(42, "big", "avatars/abc123.jpg")).toBe(
			"https://t.no.mt/avatars/abc123.jpg",
		);
	});

	it("returns direct CDN URL for any size when avatarPath is provided", () => {
		// Size is ignored, avatarPath determines direct CDN
		expect(getAvatarUrl(99, "small", "avatars/def456.png")).toBe(
			"https://t.no.mt/avatars/def456.png",
		);
	});

	it("supports cacheBust with avatarPath", () => {
		const timestamp = 1712345678000;
		expect(getAvatarUrl(42, "big", "avatars/xyz.jpg", timestamp)).toBe(
			"https://t.no.mt/avatars/xyz.jpg?v=1712345678000",
		);
	});

	it("supports cacheBust parameter for legacy proxy path", () => {
		const timestamp = 1712345678000;
		expect(getAvatarUrl(42, "big", undefined, timestamp)).toBe("/api/avatar/42?v=1712345678000");
	});

	it("cacheBust parameter works with any size (legacy proxy)", () => {
		const timestamp = 1234567890;
		// Size is ignored, cacheBust is applied
		expect(getAvatarUrl(99, "small", undefined, timestamp)).toBe("/api/avatar/99?v=1234567890");
		expect(getAvatarUrl(99, "middle", undefined, timestamp)).toBe("/api/avatar/99?v=1234567890");
	});

	it("no params when cacheBust is undefined", () => {
		expect(getAvatarUrl(42, "big", undefined, undefined)).toBe("/api/avatar/42");
	});

	it("empty avatarPath falls back to proxy", () => {
		expect(getAvatarUrl(42, "big", "")).toBe("/api/avatar/42");
	});
});

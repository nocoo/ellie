import { describe, expect, test } from "bun:test";
import { getAvatarUrl } from "../../../src/lib/avatar";

describe("getAvatarUrl", () => {
	test("returns proxy URL for UID", () => {
		expect(getAvatarUrl(12345, "big")).toBe("/api/avatar/12345");
	});

	test("returns proxy URL without size param when size is big (default)", () => {
		expect(getAvatarUrl(1, "big")).toBe("/api/avatar/1");
	});

	test("returns proxy URL with size param for middle", () => {
		expect(getAvatarUrl(123456789, "middle")).toBe("/api/avatar/123456789?size=middle");
	});

	test("returns proxy URL with size param for small", () => {
		expect(getAvatarUrl(1234567890, "small")).toBe("/api/avatar/1234567890?size=small");
	});

	test("default size is 'big' (no query param)", () => {
		expect(getAvatarUrl(12345)).toBe("/api/avatar/12345");
	});

	test("small size includes query param", () => {
		expect(getAvatarUrl(42, "small")).toBe("/api/avatar/42?size=small");
	});

	test("middle size includes query param", () => {
		expect(getAvatarUrl(42, "middle")).toBe("/api/avatar/42?size=middle");
	});
});

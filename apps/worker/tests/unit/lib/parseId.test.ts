import { describe, expect, it } from "bun:test";
import { parseIdFromPath, parsePathSegment } from "../../../src/lib/parseId";

describe("parseIdFromPath", () => {
	it("should extract trailing numeric ID", () => {
		const req = new Request("https://example.com/api/admin/forums/42");
		expect(parseIdFromPath(req)).toBe(42);
	});

	it("should return null for non-numeric last segment", () => {
		const req = new Request("https://example.com/api/admin/forums/abc");
		expect(parseIdFromPath(req)).toBeNull();
	});

	it("should handle large IDs", () => {
		const req = new Request("https://example.com/api/admin/users/999999");
		expect(parseIdFromPath(req)).toBe(999999);
	});

	it("should handle ID of 0", () => {
		const req = new Request("https://example.com/api/admin/forums/0");
		expect(parseIdFromPath(req)).toBe(0);
	});

	it("should return null for empty path segment", () => {
		const req = new Request("https://example.com/");
		expect(parseIdFromPath(req)).toBeNull();
	});

	it("should handle paths with query params", () => {
		const req = new Request("https://example.com/api/admin/forums/42?foo=bar");
		expect(parseIdFromPath(req)).toBe(42);
	});
});

describe("parsePathSegment", () => {
	it("should extract ID from second-to-last segment", () => {
		const req = new Request("https://example.com/api/admin/threads/42/sticky");
		expect(parsePathSegment(req, 1)).toBe(42);
	});

	it("should extract ID from last segment when fromEnd=0", () => {
		const req = new Request("https://example.com/api/admin/forums/42");
		expect(parsePathSegment(req, 0)).toBe(42);
	});

	it("should return null for non-numeric segment", () => {
		const req = new Request("https://example.com/api/admin/threads/abc/sticky");
		expect(parsePathSegment(req, 1)).toBeNull();
	});

	it("should handle deeper paths", () => {
		const req = new Request("https://example.com/api/admin/threads/123/move");
		expect(parsePathSegment(req, 1)).toBe(123);
	});

	it("should return null for out-of-range fromEnd", () => {
		const req = new Request("https://example.com/api/admin/forums/42");
		expect(parsePathSegment(req, 100)).toBeNull();
	});
});

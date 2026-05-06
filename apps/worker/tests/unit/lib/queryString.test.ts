import { describe, expect, it } from "vitest";
import { getQueryParam } from "../../../src/lib/queryString";

/**
 * `getQueryParam` is a fast-path replacement for
 * `new URL(request.url).searchParams.get(key)` used on hot list paths.
 *
 * These tests pin down behaviour parity with `URLSearchParams.get` for every
 * shape the public list endpoints actually accept, plus a few corner cases
 * we deliberately diverge on.
 */
describe("getQueryParam", () => {
	const ref = (url: string, key: string) => new URL(url).searchParams.get(key);

	it.each([
		["https://e.com/?forumId=5&limit=100", "forumId"],
		["https://e.com/?forumId=5&limit=100", "limit"],
		["https://e.com/?forumId=5&limit=100", "cursor"],
		["https://e.com/?forumId=5&limit=100", "page"],
		["https://e.com/?cursor=abc%3D%3D&forumId=2", "cursor"],
		["https://e.com/?cursor=abc%3D%3D&forumId=2", "forumId"],
		["https://e.com/", "limit"],
		["https://e.com/?", "limit"],
		// Non-matching prefix: `xforumId` must NOT match `forumId`
		["https://e.com/?xforumId=99&forumId=5", "forumId"],
		// Non-matching suffix: `forumIdx` must NOT match `forumId`
		["https://e.com/?forumIdx=99&forumId=5", "forumId"],
		// Repeated key: returns FIRST occurrence (matches URLSearchParams.get)
		["https://e.com/?forumId=1&forumId=2", "forumId"],
		// Plus-encoded space
		["https://e.com/?q=hello+world", "q"],
	])("matches URLSearchParams.get for %s [%s]", (url, key) => {
		expect(getQueryParam(url, key)).toBe(ref(url, key));
	});

	it("returns null for URL with no query string", () => {
		expect(getQueryParam("https://e.com/api/v1/threads", "forumId")).toBeNull();
	});

	it("decodes percent-encoded values", () => {
		expect(getQueryParam("https://e.com/?cursor=abc%3D%3D", "cursor")).toBe("abc==");
	});
});

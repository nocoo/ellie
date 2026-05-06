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

	it.each([
		["https://e.com/?cursor=%", "cursor"],
		["https://e.com/?forumId=%", "forumId"],
		["https://e.com/?cursor=%ZZ", "cursor"],
	])("returns the raw slice for malformed percent encoding %s [%s]", (url, key) => {
		// URLSearchParams.get is lenient on malformed percent encoding and
		// surfaces the raw value to the caller's own validation. Earlier we
		// threw URIError, which the global handler converted into
		// INTERNAL_ERROR (500) on something like `/api/v1/threads?forumId=%`.
		expect(getQueryParam(url, key)).toBe(ref(url, key));
	});

	it("does not throw on partial-valid + trailing-malformed sequences", () => {
		// Note: URLSearchParams decodes the leading valid sequences and keeps the
		// trailing bad chars (e.g. `%E0%A4%A` -> `\uFFFD%A`). Our fast path can't
		// recover partial decodes, so we surface the whole raw slice. Important
		// invariant: we never throw — the caller never sees a 500 from this.
		expect(() => getQueryParam("https://e.com/?cursor=%E0%A4%A", "cursor")).not.toThrow();
		expect(getQueryParam("https://e.com/?cursor=%E0%A4%A", "cursor")).toBe("%E0%A4%A");
	});
});

import { describe, expect, it } from "bun:test";
import {
	buildSearchParams,
	isValidSearchQuery,
	resolveSearchType,
} from "../../../../apps/web/src/viewmodels/forum/search";

// ---------------------------------------------------------------------------
// resolveSearchType
// ---------------------------------------------------------------------------

describe("resolveSearchType", () => {
	it("defaults to title", () => {
		expect(resolveSearchType(undefined)).toBe("title");
	});

	it("resolves title", () => {
		expect(resolveSearchType("title")).toBe("title");
	});

	it("resolves author", () => {
		expect(resolveSearchType("author")).toBe("author");
	});

	it("treats unknown values as title", () => {
		expect(resolveSearchType("invalid")).toBe("title");
	});
});

// ---------------------------------------------------------------------------
// buildSearchParams
// ---------------------------------------------------------------------------

describe("buildSearchParams", () => {
	it("builds titlePrefix param for title search", () => {
		const params = buildSearchParams("title", "同济");
		expect(params).toEqual({ titlePrefix: "同济" });
	});

	it("builds authorName param for author search", () => {
		const params = buildSearchParams("author", "admin");
		expect(params).toEqual({ authorName: "admin" });
	});

	it("passes empty query through", () => {
		expect(buildSearchParams("title", "")).toEqual({ titlePrefix: "" });
		expect(buildSearchParams("author", "")).toEqual({ authorName: "" });
	});
});

// ---------------------------------------------------------------------------
// isValidSearchQuery
// ---------------------------------------------------------------------------

describe("isValidSearchQuery", () => {
	it("rejects empty string", () => {
		expect(isValidSearchQuery("")).toBe(false);
	});

	it("rejects whitespace-only", () => {
		expect(isValidSearchQuery("   ")).toBe(false);
	});

	it("accepts non-empty query", () => {
		expect(isValidSearchQuery("同济")).toBe(true);
	});

	it("accepts query with leading/trailing whitespace", () => {
		expect(isValidSearchQuery("  test  ")).toBe(true);
	});
});

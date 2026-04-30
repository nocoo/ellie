import { describe, expect, it } from "vitest";
import { isValidSearchQuery } from "../../../../apps/web/src/viewmodels/forum/search";

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

	it("rejects single character", () => {
		expect(isValidSearchQuery("a")).toBe(false);
	});

	it("accepts 2 character query", () => {
		expect(isValidSearchQuery("ab")).toBe(true);
	});

	it("accepts non-empty query", () => {
		expect(isValidSearchQuery("同济")).toBe(true);
	});

	it("accepts query with leading/trailing whitespace", () => {
		expect(isValidSearchQuery("  test  ")).toBe(true);
	});
});

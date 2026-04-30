import { describe, expect, it } from "vitest";
import { parseIntParam, parsePageParam } from "../src/viewmodels/params";

// ---------------------------------------------------------------------------
// parseIntParam
// ---------------------------------------------------------------------------

describe("parseIntParam", () => {
	it("parses valid integer string", () => {
		expect(parseIntParam("42")).toBe(42);
	});

	it("returns null for undefined", () => {
		expect(parseIntParam(undefined)).toBeNull();
	});

	it("returns null for null", () => {
		expect(parseIntParam(null)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseIntParam("")).toBeNull();
	});

	it("returns null for non-numeric string", () => {
		expect(parseIntParam("abc")).toBeNull();
	});

	it("parses negative numbers", () => {
		expect(parseIntParam("-3")).toBe(-3);
	});

	it("truncates decimal strings", () => {
		expect(parseIntParam("3.7")).toBe(3);
	});

	it("parses zero", () => {
		expect(parseIntParam("0")).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// parsePageParam
// ---------------------------------------------------------------------------

describe("parsePageParam", () => {
	it("parses valid page number", () => {
		expect(parsePageParam("5")).toBe(5);
	});

	it("returns 1 for undefined", () => {
		expect(parsePageParam(undefined)).toBe(1);
	});

	it("returns 1 for null", () => {
		expect(parsePageParam(null)).toBe(1);
	});

	it("returns 1 for zero", () => {
		expect(parsePageParam("0")).toBe(1);
	});

	it("returns 1 for negative number", () => {
		expect(parsePageParam("-5")).toBe(1);
	});

	it("returns 1 for non-numeric string", () => {
		expect(parsePageParam("abc")).toBe(1);
	});

	it("returns the page number for valid input", () => {
		expect(parsePageParam("100")).toBe(100);
	});
});

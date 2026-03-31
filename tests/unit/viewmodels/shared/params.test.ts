import { describe, expect, it } from "bun:test";
import {
	parseIntParam,
	parsePageParam,
} from "../../../../apps/web/src/viewmodels/shared/params";

// ---------------------------------------------------------------------------
// parseIntParam
// ---------------------------------------------------------------------------

describe("parseIntParam", () => {
	it("parses valid integer string", () => {
		expect(parseIntParam("42")).toBe(42);
	});

	it("returns fallback for undefined", () => {
		expect(parseIntParam(undefined)).toBe(0);
	});

	it("returns fallback for null", () => {
		expect(parseIntParam(null)).toBe(0);
	});

	it("returns fallback for empty string", () => {
		expect(parseIntParam("")).toBe(0);
	});

	it("returns fallback for non-numeric string", () => {
		expect(parseIntParam("abc")).toBe(0);
	});

	it("uses custom fallback", () => {
		expect(parseIntParam("abc", 99)).toBe(99);
		expect(parseIntParam(undefined, 5)).toBe(5);
	});

	it("parses negative numbers", () => {
		expect(parseIntParam("-3")).toBe(-3);
	});

	it("truncates decimal strings", () => {
		expect(parseIntParam("3.7")).toBe(3);
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

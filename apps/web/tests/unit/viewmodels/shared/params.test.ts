import { parseIntParam, parsePageParam } from "@/viewmodels/shared/params";
import { describe, expect, it } from "vitest";

describe("parseIntParam", () => {
	it("returns null for null", () => {
		expect(parseIntParam(null)).toBe(null);
	});

	it("returns null for undefined", () => {
		expect(parseIntParam(undefined)).toBe(null);
	});

	it("returns null for empty string", () => {
		expect(parseIntParam("")).toBe(null);
	});

	it("returns number for valid integer string", () => {
		expect(parseIntParam("42")).toBe(42);
	});

	it("returns null for NaN input", () => {
		expect(parseIntParam("abc")).toBe(null);
	});

	it("parses negative numbers", () => {
		expect(parseIntParam("-5")).toBe(-5);
	});

	it("truncates floats", () => {
		expect(parseIntParam("3.9")).toBe(3);
	});
});

describe("parsePageParam", () => {
	it("returns 1 for null", () => {
		expect(parsePageParam(null)).toBe(1);
	});

	it("returns 1 for undefined", () => {
		expect(parsePageParam(undefined)).toBe(1);
	});

	it("returns 1 for empty string", () => {
		expect(parsePageParam("")).toBe(1);
	});

	it("returns 1 for zero", () => {
		expect(parsePageParam("0")).toBe(1);
	});

	it("returns 1 for negative", () => {
		expect(parsePageParam("-1")).toBe(1);
	});

	it("returns the number for valid page", () => {
		expect(parsePageParam("5")).toBe(5);
	});

	it("returns 1 for non-numeric", () => {
		expect(parsePageParam("abc")).toBe(1);
	});
});

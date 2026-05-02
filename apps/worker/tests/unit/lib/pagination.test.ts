import { describe, expect, it } from "vitest";
import { clampLimit } from "../../../src/lib/pagination";

describe("clampLimit", () => {
	const opts = { defaultLimit: 20, maxLimit: 50 };

	it("returns defaultLimit when param is null", () => {
		expect(clampLimit(null, opts)).toBe(20);
	});

	it("returns defaultLimit when param is empty string", () => {
		expect(clampLimit("", opts)).toBe(20);
	});

	it("preserves legacy NaN behavior for non-numeric params", () => {
		// Number.parseInt("abc") -> NaN, NaN <= 0 is false, so falls through to Math.min(NaN, 50) -> NaN.
		// This matches the original inline behavior, which also did not guard NaN. No caller relies on
		// this branch; tightening it would change existing endpoint behavior, so we lock the quirk in.
		expect(Number.isNaN(clampLimit("abc", opts))).toBe(true);
	});

	it("returns defaultLimit for zero or negative values", () => {
		expect(clampLimit("0", opts)).toBe(20);
		expect(clampLimit("-5", opts)).toBe(20);
	});

	it("returns the parsed value when within range", () => {
		expect(clampLimit("10", opts)).toBe(10);
		expect(clampLimit("50", opts)).toBe(50);
	});

	it("clamps to maxLimit when value exceeds it", () => {
		expect(clampLimit("9999", opts)).toBe(50);
	});

	it("respects custom defaultLimit / maxLimit", () => {
		const small = { defaultLimit: 5, maxLimit: 10 };
		expect(clampLimit(null, small)).toBe(5);
		expect(clampLimit("100", small)).toBe(10);
	});
});

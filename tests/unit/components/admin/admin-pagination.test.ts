import { describe, expect, it } from "bun:test";
import {
	computeItemRange,
	computePageRange,
} from "../../../../apps/web/src/components/admin/admin-pagination";

// ---------------------------------------------------------------------------
// computePageRange
// ---------------------------------------------------------------------------

describe("computePageRange", () => {
	it("returns [1, total] when total <= maxVisible", () => {
		expect(computePageRange(1, 3, 5)).toEqual([1, 3]);
		expect(computePageRange(2, 5, 5)).toEqual([1, 5]);
	});

	it("centers around current page", () => {
		expect(computePageRange(5, 10, 5)).toEqual([3, 7]);
	});

	it("clamps to start when current is near beginning", () => {
		expect(computePageRange(1, 10, 5)).toEqual([1, 5]);
		expect(computePageRange(2, 10, 5)).toEqual([1, 5]);
	});

	it("clamps to end when current is near end", () => {
		expect(computePageRange(10, 10, 5)).toEqual([6, 10]);
		expect(computePageRange(9, 10, 5)).toEqual([6, 10]);
	});

	it("handles single page", () => {
		expect(computePageRange(1, 1, 5)).toEqual([1, 1]);
	});

	it("handles zero pages", () => {
		expect(computePageRange(1, 0, 5)).toEqual([1, 0]);
	});
});

// ---------------------------------------------------------------------------
// computeItemRange
// ---------------------------------------------------------------------------

describe("computeItemRange", () => {
	it("computes correct range for first page", () => {
		expect(computeItemRange(1, 20, 150)).toBe("1–20");
	});

	it("computes correct range for middle page", () => {
		expect(computeItemRange(3, 20, 150)).toBe("41–60");
	});

	it("computes correct range for last page (partial)", () => {
		expect(computeItemRange(8, 20, 150)).toBe("141–150");
	});

	it("handles single item", () => {
		expect(computeItemRange(1, 20, 1)).toBe("1–1");
	});

	it("handles exact page boundary", () => {
		expect(computeItemRange(5, 20, 100)).toBe("81–100");
	});
});

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

	it("handles maxVisible of 1", () => {
		expect(computePageRange(3, 10, 1)).toEqual([3, 3]);
	});

	it("handles maxVisible of 2", () => {
		// half = 1, start = 3 - 1 = 2, end = 3 + 1 = 4
		expect(computePageRange(3, 10, 2)).toEqual([2, 4]);
	});

	it("clamps start to 1 when current - half < 1 with maxVisible=2", () => {
		expect(computePageRange(1, 10, 2)).toEqual([1, 2]);
	});

	it("clamps to end with maxVisible=2 at last page", () => {
		expect(computePageRange(10, 10, 2)).toEqual([9, 10]);
	});

	it("handles even maxVisible=4 centered on page 5 of 10", () => {
		// half = 2, start = 5-2=3, end = 5+2=7
		expect(computePageRange(5, 10, 4)).toEqual([3, 7]);
	});

	it("handles exactly maxVisible pages", () => {
		expect(computePageRange(3, 7, 7)).toEqual([1, 7]);
	});

	it("handles current at boundary with maxVisible=3", () => {
		// half = 1, start = 1-1=0 -> clamped to 1, end = maxVisible=3
		expect(computePageRange(1, 10, 3)).toEqual([1, 3]);
		// end clamped: current=10, start=10-1=9, end=10+1=11->10, start=max(1, 10-3+1)=8
		expect(computePageRange(10, 10, 3)).toEqual([8, 10]);
	});
});

// ---------------------------------------------------------------------------
// computeItemRange
// ---------------------------------------------------------------------------

describe("computeItemRange", () => {
	it("computes correct range for first page", () => {
		expect(computeItemRange(1, 20, 150)).toBe("1\u201320");
	});

	it("computes correct range for middle page", () => {
		expect(computeItemRange(3, 20, 150)).toBe("41\u201360");
	});

	it("computes correct range for last page (partial)", () => {
		expect(computeItemRange(8, 20, 150)).toBe("141\u2013150");
	});

	it("handles single item", () => {
		expect(computeItemRange(1, 20, 1)).toBe("1\u20131");
	});

	it("handles exact page boundary", () => {
		expect(computeItemRange(5, 20, 100)).toBe("81\u2013100");
	});

	it("handles limit of 1", () => {
		expect(computeItemRange(3, 1, 10)).toBe("3\u20133");
	});

	it("handles page 1 with limit 1 and total 10", () => {
		expect(computeItemRange(1, 1, 10)).toBe("1\u20131");
	});

	it("handles total less than limit", () => {
		expect(computeItemRange(1, 100, 5)).toBe("1\u20135");
	});

	it("handles total equal to limit", () => {
		expect(computeItemRange(1, 50, 50)).toBe("1\u201350");
	});
});

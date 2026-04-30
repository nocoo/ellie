import { describe, expect, it } from "vitest";
import { generatePageNumbers } from "../../../../apps/web/src/viewmodels/shared/pagination";

// ---------------------------------------------------------------------------
// generatePageNumbers
// ---------------------------------------------------------------------------

describe("generatePageNumbers", () => {
	it("returns all pages when total <= headCount + tailCount + 1", () => {
		expect(generatePageNumbers(1, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(generatePageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
	});

	it("returns empty for zero or negative total", () => {
		expect(generatePageNumbers(1, 0)).toEqual([]);
		expect(generatePageNumbers(1, -1)).toEqual([]);
	});

	it("returns single page", () => {
		expect(generatePageNumbers(1, 1)).toEqual([1]);
	});

	it("shows head + ellipsis + tail when current is near start", () => {
		const result = generatePageNumbers(1, 50);
		// Should be: 1 2 3 4 5 ... 48 49 50
		expect(result).toEqual([1, 2, 3, 4, 5, "ellipsis", 48, 49, 50]);
	});

	it("shows head + ellipsis + tail when current is page 3", () => {
		const result = generatePageNumbers(3, 50);
		// Current=3, window=±2 → 1..5, and tail 48..50
		// Head: 1,2,3,4,5. Window around 3: 1,2,3,4,5. Tail: 48,49,50
		// Merged: 1,2,3,4,5,...,48,49,50
		expect(result).toEqual([1, 2, 3, 4, 5, "ellipsis", 48, 49, 50]);
	});

	it("shows head + ellipsis + window + ellipsis + tail when current is in middle", () => {
		const result = generatePageNumbers(25, 50);
		// Head: 1,2,3,4,5. Window: 23,24,25,26,27. Tail: 48,49,50
		// → 1,2,3,4,5,...,23,24,25,26,27,...,48,49,50
		expect(result).toEqual([1, 2, 3, 4, 5, "ellipsis", 23, 24, 25, 26, 27, "ellipsis", 48, 49, 50]);
	});

	it("shows head + ellipsis + tail when current is near end", () => {
		const result = generatePageNumbers(49, 50);
		// Head: 1,2,3,4,5. Window: 47,48,49,50. Tail: 48,49,50
		// Merged: 1,2,3,4,5,...,47,48,49,50
		expect(result).toEqual([1, 2, 3, 4, 5, "ellipsis", 47, 48, 49, 50]);
	});

	it("merges window with head when current is page 6", () => {
		const result = generatePageNumbers(6, 50);
		// Head: 1,2,3,4,5. Window: 4,5,6,7,8. Tail: 48,49,50
		// Merged: 1,2,3,4,5,6,7,8,...,48,49,50 (no gap between 5 and 4)
		expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, "ellipsis", 48, 49, 50]);
	});

	it("merges window with tail when current is page 46", () => {
		const result = generatePageNumbers(46, 50);
		// Head: 1,2,3,4,5. Window: 44,45,46,47,48. Tail: 48,49,50
		// Merged: 1,2,3,4,5,...,44,45,46,47,48,49,50
		expect(result).toEqual([1, 2, 3, 4, 5, "ellipsis", 44, 45, 46, 47, 48, 49, 50]);
	});

	it("handles exactly 9 pages (threshold)", () => {
		// headCount=5 + tailCount=3 + 1 = 9, so all pages shown
		expect(generatePageNumbers(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("handles 10 pages with ellipsis", () => {
		const result = generatePageNumbers(1, 10);
		// Head: 1,2,3,4,5. Tail: 8,9,10
		// → 1,2,3,4,5,...,8,9,10
		expect(result).toEqual([1, 2, 3, 4, 5, "ellipsis", 8, 9, 10]);
	});
});

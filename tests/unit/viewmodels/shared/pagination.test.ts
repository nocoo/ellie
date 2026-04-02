import { describe, expect, it } from "bun:test";
import {
	emptyPage,
	generatePageNumbers,
} from "../../../../apps/web/src/viewmodels/shared/pagination";

// ---------------------------------------------------------------------------
// emptyPage
// ---------------------------------------------------------------------------

describe("emptyPage", () => {
	it("returns an empty paginated result", () => {
		const page = emptyPage<string>();
		expect(page).toEqual({
			items: [],
			nextCursor: null,
			prevCursor: null,
			total: 0,
		});
	});

	it("returns a new object each call", () => {
		const page1 = emptyPage();
		const page2 = emptyPage();
		expect(page1).not.toBe(page2);
	});
});

// ---------------------------------------------------------------------------
// generatePageNumbers
// ---------------------------------------------------------------------------

describe("generatePageNumbers", () => {
	it("returns empty array for total <= 0", () => {
		expect(generatePageNumbers(1, 0)).toEqual([]);
		expect(generatePageNumbers(1, -1)).toEqual([]);
	});

	it("returns all pages when total <= headCount + tailCount + 1", () => {
		// Default: headCount=5, tailCount=3, so threshold is 9
		expect(generatePageNumbers(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("returns all pages for small total", () => {
		expect(generatePageNumbers(1, 3)).toEqual([1, 2, 3]);
		expect(generatePageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5]);
	});

	it("returns single page", () => {
		expect(generatePageNumbers(1, 1)).toEqual([1]);
	});

	it("generates ellipsis for large page counts", () => {
		// 20 pages, current=10, headCount=5, tailCount=3, windowSize=2
		const pages = generatePageNumbers(10, 20);
		// Should contain ellipsis
		expect(pages).toContain("ellipsis");
		// First page should be 1
		expect(pages[0]).toBe(1);
		// Last page should be 20
		expect(pages[pages.length - 1]).toBe(20);
		// Current page 10 should be present
		expect(pages).toContain(10);
		// Pages around current (8, 9, 10, 11, 12) should be present
		expect(pages).toContain(8);
		expect(pages).toContain(12);
	});

	it("includes head pages (1..5) for large total", () => {
		const pages = generatePageNumbers(15, 30);
		expect(pages).toContain(1);
		expect(pages).toContain(2);
		expect(pages).toContain(3);
		expect(pages).toContain(4);
		expect(pages).toContain(5);
	});

	it("includes tail pages for large total", () => {
		const pages = generatePageNumbers(5, 30);
		// Default tailCount=3, so last 3 pages: 28, 29, 30
		expect(pages).toContain(28);
		expect(pages).toContain(29);
		expect(pages).toContain(30);
	});

	it("includes window around current page", () => {
		const pages = generatePageNumbers(15, 30);
		// windowSize=2, so 13, 14, 15, 16, 17
		expect(pages).toContain(13);
		expect(pages).toContain(14);
		expect(pages).toContain(15);
		expect(pages).toContain(16);
		expect(pages).toContain(17);
	});

	it("handles current page at start", () => {
		const pages = generatePageNumbers(1, 20);
		expect(pages).toContain(1);
		expect(pages[0]).toBe(1);
	});

	it("handles current page at end", () => {
		const pages = generatePageNumbers(20, 20);
		expect(pages).toContain(20);
		expect(pages[pages.length - 1]).toBe(20);
	});

	it("no ellipsis when all pages fit within head+tail+window", () => {
		// headCount=5, tailCount=3, window around 5 with size=2 means 3..7
		// Total=10: head=1..5, window=3..7, tail=8..10
		// All merge into 1..10, so threshold check: 10 <= 5+3+1=9? No, 10 > 9
		// So it enters the complex path but pages may still merge without gaps
		const pages = generatePageNumbers(5, 10);
		// Verify all pages 1..10 are present
		for (let i = 1; i <= 10; i++) {
			expect(pages).toContain(i);
		}
	});

	it("uses custom headCount, tailCount, and windowSize", () => {
		// Small custom values: head=2, tail=1, window=1
		const pages = generatePageNumbers(10, 20, 2, 1, 1);
		// Head: 1, 2
		expect(pages).toContain(1);
		expect(pages).toContain(2);
		// Window around 10: 9, 10, 11
		expect(pages).toContain(9);
		expect(pages).toContain(10);
		expect(pages).toContain(11);
		// Tail: 20
		expect(pages).toContain(20);
	});

	it("places ellipsis between head and window", () => {
		const pages = generatePageNumbers(15, 30);
		const firstEllipsisIdx = pages.indexOf("ellipsis");
		expect(firstEllipsisIdx).toBeGreaterThan(-1);
		// Before ellipsis should be a number from head
		expect(typeof pages[firstEllipsisIdx - 1]).toBe("number");
		// After ellipsis should be a number from window
		expect(typeof pages[firstEllipsisIdx + 1]).toBe("number");
	});

	it("handles total exactly at threshold boundary", () => {
		// headCount + tailCount + 1 = 5 + 3 + 1 = 9
		// total=9 should return all pages without ellipsis
		expect(generatePageNumbers(5, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		// total=10 should use complex path
		const pages = generatePageNumbers(5, 10);
		expect(pages).toHaveLength(10);
		expect(pages).not.toContain("ellipsis");
	});

	it("deduplicates page numbers", () => {
		const pages = generatePageNumbers(5, 20);
		const numberPages = pages.filter((p): p is number => typeof p === "number");
		const unique = new Set(numberPages);
		expect(numberPages.length).toBe(unique.size);
	});
});

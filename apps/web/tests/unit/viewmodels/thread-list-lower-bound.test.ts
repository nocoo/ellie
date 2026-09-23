// lowerBoundPages (doc/29): displayed page count is a lower bound — at least
// the current page, one more while hasNext holds, never clamped by a stale
// cached total, and an empty final page keeps its number for prev navigation.

import { describe, expect, it } from "vitest";
import { lowerBoundPages } from "@/viewmodels/forum/thread-list";

describe("lowerBoundPages", () => {
	it("derives pages from the authoritative total", () => {
		expect(lowerBoundPages(1, 50, 100, false)).toBe(2);
		expect(lowerBoundPages(2, 50, 100, false)).toBe(2);
	});

	it("extends by one while hasNext holds", () => {
		expect(lowerBoundPages(2, 50, 100, true)).toBe(3);
		expect(lowerBoundPages(2, 50, 101, true)).toBe(3);
	});

	it("never clamps a real requested page to a stale low total", () => {
		expect(lowerBoundPages(5, 50, 40, false)).toBe(5);
	});

	it("keeps an empty final page navigable backwards", () => {
		expect(lowerBoundPages(5, 50, 0, false)).toBe(5);
	});

	it("is robust to non-finite or non-positive inputs", () => {
		expect(lowerBoundPages(Number.NaN, 50, 100, false)).toBe(2);
		expect(lowerBoundPages(0, 50, 100, false)).toBe(2);
		expect(lowerBoundPages(1, 0, 100, false)).toBe(100);
		expect(lowerBoundPages(1, 50, Number.NaN, false)).toBe(1);
		expect(lowerBoundPages(1, 50, -5, false)).toBe(1);
	});
});

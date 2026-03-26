import { describe, expect, test } from "bun:test";
import { SORT_OPTIONS } from "@/components/forum/thread-sort-controls";

describe("ThreadSortControls", () => {
	describe("SORT_OPTIONS", () => {
		test("has three sort options", () => {
			expect(SORT_OPTIONS).toHaveLength(3);
		});

		test("includes latest, newest, hot", () => {
			const values = SORT_OPTIONS.map((o) => o.value);
			expect(values).toContain("latest");
			expect(values).toContain("newest");
			expect(values).toContain("hot");
		});

		test("all options have labels", () => {
			for (const option of SORT_OPTIONS) {
				expect(option.label.length).toBeGreaterThan(0);
			}
		});
	});
});

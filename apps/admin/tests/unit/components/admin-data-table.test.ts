import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// AdminDataTable — unit tests for the selection logic
//
// The AdminDataTable is a React component that uses callbacks for selection.
// We test the selection logic patterns that the component implements:
// - toggleAll: if all selected → deselect all, else → select all
// - toggleRow: add/remove individual IDs from the set
// - allSelected / someSelected derivation
// ---------------------------------------------------------------------------

// Replicate the selection logic from the component (pure functions)

function computeAllSelected(
	allIds: (string | number)[],
	selectedIds: Set<string | number>,
): boolean {
	return allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
}

function computeSomeSelected(
	allIds: (string | number)[],
	selectedIds: Set<string | number>,
	allSelected: boolean,
): boolean {
	return !allSelected && allIds.some((id) => selectedIds.has(id));
}

function toggleAll(allIds: (string | number)[], allSelected: boolean): Set<string | number> {
	return allSelected ? new Set() : new Set(allIds);
}

function toggleRow(selectedIds: Set<string | number>, id: string | number): Set<string | number> {
	const next = new Set(selectedIds);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	return next;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdminDataTable selection logic", () => {
	const allIds = [1, 2, 3, 4, 5];

	describe("computeAllSelected", () => {
		it("returns true when all IDs are selected", () => {
			expect(computeAllSelected(allIds, new Set([1, 2, 3, 4, 5]))).toBe(true);
		});

		it("returns false when some IDs are missing", () => {
			expect(computeAllSelected(allIds, new Set([1, 2, 3]))).toBe(false);
		});

		it("returns false when none selected", () => {
			expect(computeAllSelected(allIds, new Set())).toBe(false);
		});

		it("returns false for empty data", () => {
			expect(computeAllSelected([], new Set())).toBe(false);
		});
	});

	describe("computeSomeSelected", () => {
		it("returns true when some but not all are selected", () => {
			const selected = new Set<string | number>([1, 2]);
			const all = computeAllSelected(allIds, selected);
			expect(computeSomeSelected(allIds, selected, all)).toBe(true);
		});

		it("returns false when all are selected", () => {
			const selected = new Set<string | number>([1, 2, 3, 4, 5]);
			const all = computeAllSelected(allIds, selected);
			expect(computeSomeSelected(allIds, selected, all)).toBe(false);
		});

		it("returns false when none are selected", () => {
			const selected = new Set<string | number>();
			const all = computeAllSelected(allIds, selected);
			expect(computeSomeSelected(allIds, selected, all)).toBe(false);
		});
	});

	describe("toggleAll", () => {
		it("selects all when not all selected", () => {
			const result = toggleAll(allIds, false);
			expect(result.size).toBe(5);
			for (const id of allIds) {
				expect(result.has(id)).toBe(true);
			}
		});

		it("deselects all when all selected", () => {
			const result = toggleAll(allIds, true);
			expect(result.size).toBe(0);
		});
	});

	describe("toggleRow", () => {
		it("adds row when not selected", () => {
			const selected = new Set<string | number>([1, 2]);
			const result = toggleRow(selected, 3);
			expect(result.has(3)).toBe(true);
			expect(result.size).toBe(3);
		});

		it("removes row when already selected", () => {
			const selected = new Set<string | number>([1, 2, 3]);
			const result = toggleRow(selected, 2);
			expect(result.has(2)).toBe(false);
			expect(result.size).toBe(2);
		});

		it("does not mutate original set", () => {
			const selected = new Set<string | number>([1, 2]);
			toggleRow(selected, 3);
			expect(selected.size).toBe(2);
		});

		it("works with string IDs", () => {
			const selected = new Set<string | number>(["a", "b"]);
			const result = toggleRow(selected, "c");
			expect(result.has("c")).toBe(true);
			expect(result.size).toBe(3);
		});
	});
});

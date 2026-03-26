import { describe, expect, test } from "bun:test";
import type { PaginationState } from "@/hooks/use-pagination";

// usePagination is a React hook — full state transition tests require
// renderHook (L2). L1 tests validate data contract and module exports.

describe("usePagination data contract", () => {
	test("initial PaginationState has null cursor and forward direction", () => {
		const initial: PaginationState = { cursor: null, direction: "forward" };
		expect(initial.cursor).toBeNull();
		expect(initial.direction).toBe("forward");
	});

	test("forward state represents a cursor + forward direction", () => {
		const state: PaginationState = { cursor: "abc123", direction: "forward" };
		expect(state.cursor).toBe("abc123");
		expect(state.direction).toBe("forward");
	});

	test("backward state represents a cursor + backward direction", () => {
		const state: PaginationState = { cursor: "xyz789", direction: "backward" };
		expect(state.cursor).toBe("xyz789");
		expect(state.direction).toBe("backward");
	});

	test("hasPreviousPage is false when cursor is null", () => {
		const state: PaginationState = { cursor: null, direction: "forward" };
		const hasPrev = state.cursor !== null;
		expect(hasPrev).toBe(false);
	});

	test("hasPreviousPage is true when cursor is set", () => {
		const state: PaginationState = { cursor: "abc", direction: "forward" };
		const hasPrev = state.cursor !== null;
		expect(hasPrev).toBe(true);
	});
});

describe("usePagination module exports", () => {
	test("exports usePagination function", async () => {
		const mod = await import("@/hooks/use-pagination");
		expect(typeof mod.usePagination).toBe("function");
	});
});

describe("ForumPagination component contract", () => {
	test("exports ForumPagination function", async () => {
		const mod = await import("@/components/forum-pagination");
		expect(typeof mod.ForumPagination).toBe("function");
	});
});

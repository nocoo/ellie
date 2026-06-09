import { describe, expect, it, vi } from "vitest";
import {
	buildUserSearchParams,
	formatPurgeBatchSummary,
	parseUsersResponse,
	runPurgeBatchSerial,
} from "@/viewmodels/admin/use-users-admin";

// Helper to build a fully-defaulted UserFilters for tests; lets each
// test override only the keys it cares about (esp. the 10 range keys
// added in Batch F).
function makeFilters(
	overrides: Partial<Record<string, string>> = {},
): Parameters<typeof buildUserSearchParams>[2] {
	return {
		search: "",
		status: "",
		role: "",
		regIp: "",
		lastIp: "",
		regDateMin: "",
		regDateMax: "",
		lastLoginMin: "",
		lastLoginMax: "",
		threadsMin: "",
		threadsMax: "",
		postsMin: "",
		postsMax: "",
		creditsMin: "",
		creditsMax: "",
		...overrides,
	} as Parameters<typeof buildUserSearchParams>[2];
}

describe("use-users-admin helpers", () => {
	describe("buildUserSearchParams", () => {
		it("sets page and limit", () => {
			const params = buildUserSearchParams(2, 10, makeFilters());
			expect(params.get("page")).toBe("2");
			expect(params.get("limit")).toBe("10");
		});

		it("includes username when search is non-empty", () => {
			const params = buildUserSearchParams(1, 20, makeFilters({ search: "john" }));
			expect(params.get("username")).toBe("john");
		});

		it("omits username when search is empty", () => {
			const params = buildUserSearchParams(1, 20, makeFilters());
			expect(params.has("username")).toBe(false);
		});

		it("includes status when non-empty", () => {
			const params = buildUserSearchParams(1, 20, makeFilters({ status: "-1" }));
			expect(params.get("status")).toBe("-1");
		});

		it("includes role when non-empty", () => {
			const params = buildUserSearchParams(1, 20, makeFilters({ role: "1" }));
			expect(params.get("role")).toBe("1");
		});

		it("includes regIp / lastIp when non-empty", () => {
			const params = buildUserSearchParams(
				1,
				20,
				makeFilters({ regIp: "1.2.3.4", lastIp: "5.6.7.8" }),
			);
			expect(params.get("regIp")).toBe("1.2.3.4");
			expect(params.get("lastIp")).toBe("5.6.7.8");
		});

		it("omits regIp / lastIp when empty", () => {
			const params = buildUserSearchParams(1, 20, makeFilters());
			expect(params.has("regIp")).toBe(false);
			expect(params.has("lastIp")).toBe(false);
		});

		// --- Batch F: advanced range filters -----------------------------

		it("converts daterange (regDate) to inclusive unix-seconds bounds", () => {
			const params = buildUserSearchParams(
				1,
				20,
				makeFilters({ regDateMin: "2026-05-07", regDateMax: "2026-05-07" }),
			);
			const min = Number(params.get("regDateMin"));
			const max = Number(params.get("regDateMax"));
			expect(Number.isFinite(min)).toBe(true);
			expect(Number.isFinite(max)).toBe(true);
			// 23:59:59 - 00:00:00 of the same local day = 86399 seconds.
			expect(max - min).toBe(86399);
		});

		it("omits malformed daterange values silently", () => {
			const params = buildUserSearchParams(
				1,
				20,
				makeFilters({ regDateMin: "not-a-date", regDateMax: "" }),
			);
			expect(params.has("regDateMin")).toBe(false);
			expect(params.has("regDateMax")).toBe(false);
		});

		it("emits only one side of a date range when only one bound is set", () => {
			const params = buildUserSearchParams(1, 20, makeFilters({ lastLoginMin: "2026-01-01" }));
			expect(params.has("lastLoginMin")).toBe(true);
			expect(params.has("lastLoginMax")).toBe(false);
		});

		it("includes numeric range bounds for threads / posts / credits", () => {
			const params = buildUserSearchParams(
				1,
				20,
				makeFilters({
					threadsMin: "5",
					threadsMax: "100",
					postsMin: "10",
					creditsMax: "999",
				}),
			);
			expect(params.get("threadsMin")).toBe("5");
			expect(params.get("threadsMax")).toBe("100");
			expect(params.get("postsMin")).toBe("10");
			expect(params.has("postsMax")).toBe(false);
			expect(params.get("creditsMax")).toBe("999");
		});

		it("keeps `0` as a real numeric range bound (not falsy-dropped)", () => {
			// Locks the same `Number.isFinite` survival guarantee that
			// Batch A wired into the worker — UI-side parsing must agree.
			const params = buildUserSearchParams(
				1,
				20,
				makeFilters({ creditsMin: "0", lastLoginMin: "" }),
			);
			expect(params.get("creditsMin")).toBe("0");
		});

		it("omits non-finite numeric range bounds", () => {
			const params = buildUserSearchParams(
				1,
				20,
				makeFilters({ threadsMin: "abc", postsMax: " " }),
			);
			expect(params.has("threadsMin")).toBe(false);
			expect(params.has("postsMax")).toBe(false);
		});

		it("composes basic + advanced filters in the same params block", () => {
			const params = buildUserSearchParams(
				3,
				50,
				makeFilters({
					search: "alice",
					status: "0",
					threadsMin: "1",
					creditsMax: "500",
				}),
			);
			expect(params.get("page")).toBe("3");
			expect(params.get("limit")).toBe("50");
			expect(params.get("username")).toBe("alice");
			expect(params.get("status")).toBe("0");
			expect(params.get("threadsMin")).toBe("1");
			expect(params.get("creditsMax")).toBe("500");
		});
	});

	describe("parseUsersResponse", () => {
		it("parses complete response", () => {
			const json = {
				data: [{ id: 1 }],
				meta: { page: 2, pages: 5, total: 100, limit: 20 },
			};
			const result = parseUsersResponse(json as any, 1);
			expect(result.data).toHaveLength(1);
			expect(result.pagination.page).toBe(2);
			expect(result.pagination.pages).toBe(5);
			expect(result.pagination.total).toBe(100);
		});

		it("uses fallback page when meta is missing", () => {
			const json = {};
			const result = parseUsersResponse(json as any, 3);
			expect(result.data).toEqual([]);
			expect(result.pagination.page).toBe(3);
			expect(result.pagination.pages).toBe(0);
			expect(result.pagination.total).toBe(0);
			expect(result.pagination.limit).toBe(100);
		});

		it("handles partial meta", () => {
			const json = { data: [], meta: { page: 1 } };
			const result = parseUsersResponse(json as any, 1);
			expect(result.pagination.pages).toBe(0);
			expect(result.pagination.total).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Batch G — serial batch purge helpers.
	// -----------------------------------------------------------------------

	describe("runPurgeBatchSerial", () => {
		it("invokes purgeFn for each id in order", async () => {
			const calls: number[] = [];
			const purgeFn = vi.fn(async (id: number) => {
				calls.push(id);
			});
			const outcome = await runPurgeBatchSerial([1, 2, 3], purgeFn);
			expect(calls).toEqual([1, 2, 3]);
			expect(outcome.succeeded).toEqual([1, 2, 3]);
			expect(outcome.failed).toEqual([]);
			expect(purgeFn).toHaveBeenCalledTimes(3);
		});

		it("runs strictly serial (no concurrency)", async () => {
			let inFlight = 0;
			let maxInFlight = 0;
			const purgeFn = vi.fn(async () => {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((r) => setTimeout(r, 5));
				inFlight -= 1;
			});
			await runPurgeBatchSerial([1, 2, 3, 4], purgeFn);
			expect(maxInFlight).toBe(1);
		});

		it("captures per-id failures with extracted error messages", async () => {
			const purgeFn = vi.fn(async (id: number) => {
				if (id === 2) throw new Error("boom");
				if (id === 4) throw new Error("staff guard");
			});
			const outcome = await runPurgeBatchSerial([1, 2, 3, 4], purgeFn);
			expect(outcome.succeeded).toEqual([1, 3]);
			expect(outcome.failed).toEqual([
				{ id: 2, error: "boom" },
				{ id: 4, error: "staff guard" },
			]);
		});

		it("never silently drops a failure (one bad id keeps the rest going)", async () => {
			const purgeFn = vi.fn(async (id: number) => {
				if (id === 1) throw new Error("first failed");
			});
			const outcome = await runPurgeBatchSerial([1, 2], purgeFn);
			expect(outcome.failed).toHaveLength(1);
			expect(outcome.succeeded).toEqual([2]);
		});

		it("returns empty outcome for empty id list (no purgeFn calls)", async () => {
			const purgeFn = vi.fn();
			const outcome = await runPurgeBatchSerial([], purgeFn);
			expect(outcome).toEqual({ succeeded: [], failed: [] });
			expect(purgeFn).not.toHaveBeenCalled();
		});

		it("falls back to default error text for non-Error throws", async () => {
			const purgeFn = vi.fn(async () => {
				throw "raw string"; // not an Error
			});
			const outcome = await runPurgeBatchSerial([7], purgeFn);
			expect(outcome.failed[0]?.id).toBe(7);
			expect(outcome.failed[0]?.error).toBe("彻底清除失败");
		});
	});

	describe("formatPurgeBatchSummary", () => {
		it("returns null for an empty outcome (no banner)", () => {
			expect(formatPurgeBatchSummary({ succeeded: [], failed: [] })).toBeNull();
		});

		it("formats success-only outcome", () => {
			expect(formatPurgeBatchSummary({ succeeded: [1, 2, 3], failed: [] })).toBe(
				"批量清除完成：成功 3，失败 0",
			);
		});

		it("formats mixed outcome and includes failed-id reasons", () => {
			const text = formatPurgeBatchSummary({
				succeeded: [1, 2],
				failed: [
					{ id: 5, error: "staff guard" },
					{ id: 6, error: "already purged" },
				],
			});
			expect(text).toContain("成功 2");
			expect(text).toContain("失败 2");
			expect(text).toContain("#5: staff guard");
			expect(text).toContain("#6: already purged");
		});

		it("caps detail to first 3 failures and notes the remainder", () => {
			const text = formatPurgeBatchSummary({
				succeeded: [],
				failed: [
					{ id: 1, error: "e1" },
					{ id: 2, error: "e2" },
					{ id: 3, error: "e3" },
					{ id: 4, error: "e4" },
					{ id: 5, error: "e5" },
				],
			});
			expect(text).toContain("#1: e1");
			expect(text).toContain("#3: e3");
			expect(text).not.toContain("#4: e4");
			expect(text).toContain("等 5 项");
		});
	});
});

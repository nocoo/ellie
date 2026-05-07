import { buildUserSearchParams, parseUsersResponse } from "@/viewmodels/admin/use-users-admin";
import { describe, expect, it } from "vitest";

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
});

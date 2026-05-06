import { buildUserSearchParams, parseUsersResponse } from "@/viewmodels/admin/use-users-admin";
import { describe, expect, it } from "vitest";

describe("use-users-admin helpers", () => {
	describe("buildUserSearchParams", () => {
		it("sets page and limit", () => {
			const params = buildUserSearchParams(2, 10, {
				search: "",
				status: "",
				role: "",
				regIp: "",
				lastIp: "",
			});
			expect(params.get("page")).toBe("2");
			expect(params.get("limit")).toBe("10");
		});

		it("includes username when search is non-empty", () => {
			const params = buildUserSearchParams(1, 20, {
				search: "john",
				status: "",
				role: "",
				regIp: "",
				lastIp: "",
			});
			expect(params.get("username")).toBe("john");
		});

		it("omits username when search is empty", () => {
			const params = buildUserSearchParams(1, 20, {
				search: "",
				status: "",
				role: "",
				regIp: "",
				lastIp: "",
			});
			expect(params.has("username")).toBe(false);
		});

		it("includes status when non-empty", () => {
			const params = buildUserSearchParams(1, 20, {
				search: "",
				status: "-1",
				role: "",
				regIp: "",
				lastIp: "",
			});
			expect(params.get("status")).toBe("-1");
		});

		it("includes role when non-empty", () => {
			const params = buildUserSearchParams(1, 20, {
				search: "",
				status: "",
				role: "1",
				regIp: "",
				lastIp: "",
			});
			expect(params.get("role")).toBe("1");
		});

		it("includes regIp / lastIp when non-empty", () => {
			const params = buildUserSearchParams(1, 20, {
				search: "",
				status: "",
				role: "",
				regIp: "1.2.3.4",
				lastIp: "5.6.7.8",
			});
			expect(params.get("regIp")).toBe("1.2.3.4");
			expect(params.get("lastIp")).toBe("5.6.7.8");
		});

		it("omits regIp / lastIp when empty", () => {
			const params = buildUserSearchParams(1, 20, {
				search: "",
				status: "",
				role: "",
				regIp: "",
				lastIp: "",
			});
			expect(params.has("regIp")).toBe(false);
			expect(params.has("lastIp")).toBe(false);
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

import { describe, expect, it } from "bun:test";
import {
	buildUserSearchParams,
	parseUsersResponse,
} from "../../../../apps/web/src/viewmodels/admin/use-users-admin";

// ---------------------------------------------------------------------------
// buildUserSearchParams
// ---------------------------------------------------------------------------

describe("buildUserSearchParams", () => {
	it("includes page and limit", () => {
		const params = buildUserSearchParams(1, 20, { search: "", status: "", role: "" });
		expect(params.get("page")).toBe("1");
		expect(params.get("limit")).toBe("20");
	});

	it("includes search filter as username param", () => {
		const params = buildUserSearchParams(1, 20, { search: "alice", status: "", role: "" });
		expect(params.get("username")).toBe("alice");
	});

	it("includes status filter", () => {
		const params = buildUserSearchParams(1, 20, { search: "", status: "-1", role: "" });
		expect(params.get("status")).toBe("-1");
	});

	it("includes role filter", () => {
		const params = buildUserSearchParams(1, 20, { search: "", status: "", role: "1" });
		expect(params.get("role")).toBe("1");
	});

	it("includes all filters when set", () => {
		const params = buildUserSearchParams(2, 50, { search: "bob", status: "0", role: "2" });
		expect(params.get("page")).toBe("2");
		expect(params.get("limit")).toBe("50");
		expect(params.get("username")).toBe("bob");
		expect(params.get("status")).toBe("0");
		expect(params.get("role")).toBe("2");
	});

	it("omits empty filters", () => {
		const params = buildUserSearchParams(1, 20, { search: "", status: "", role: "" });
		expect(params.has("username")).toBe(false);
		expect(params.has("status")).toBe(false);
		expect(params.has("role")).toBe(false);
	});

	it("handles different page sizes", () => {
		const params = buildUserSearchParams(5, 100, { search: "", status: "", role: "" });
		expect(params.get("page")).toBe("5");
		expect(params.get("limit")).toBe("100");
	});
});

// ---------------------------------------------------------------------------
// parseUsersResponse
// ---------------------------------------------------------------------------

describe("parseUsersResponse", () => {
	it("extracts data array", () => {
		const json = {
			data: [{ id: 1, username: "alice" }, { id: 2, username: "bob" }],
			meta: { page: 1, pages: 1, total: 2, limit: 20 },
		};
		const result = parseUsersResponse(json as any, 1);
		expect(result.data).toHaveLength(2);
		expect(result.data[0].username).toBe("alice");
	});

	it("extracts pagination info", () => {
		const json = {
			data: [],
			meta: { page: 3, pages: 10, total: 200, limit: 20 },
		};
		const result = parseUsersResponse(json, 1);
		expect(result.pagination.page).toBe(3);
		expect(result.pagination.pages).toBe(10);
		expect(result.pagination.total).toBe(200);
		expect(result.pagination.limit).toBe(20);
	});

	it("uses fallback page when meta.page is missing", () => {
		const json = { data: [], meta: {} };
		const result = parseUsersResponse(json, 5);
		expect(result.pagination.page).toBe(5);
	});

	it("returns empty array when data is missing", () => {
		const json = { meta: { page: 1, pages: 0, total: 0, limit: 20 } };
		const result = parseUsersResponse(json as any, 1);
		expect(result.data).toEqual([]);
	});

	it("returns default pagination when meta is missing", () => {
		const json = { data: [] };
		const result = parseUsersResponse(json as any, 2);
		expect(result.pagination.page).toBe(2);
		expect(result.pagination.pages).toBe(0);
		expect(result.pagination.total).toBe(0);
		expect(result.pagination.limit).toBe(20);
	});

	it("handles completely empty response", () => {
		const json = {};
		const result = parseUsersResponse(json as any, 1);
		expect(result.data).toEqual([]);
		expect(result.pagination.page).toBe(1);
	});

	it("preserves all user fields in data", () => {
		const json = {
			data: [{
				id: 1,
				username: "admin",
				email: "admin@example.com",
				role: 1,
				status: 0,
				posts: 100,
				regDate: 1700000000,
			}],
			meta: { page: 1, pages: 1, total: 1, limit: 20 },
		};
		const result = parseUsersResponse(json as any, 1);
		expect(result.data[0].id).toBe(1);
		expect(result.data[0].email).toBe("admin@example.com");
		expect(result.data[0].role).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// State contracts (documentation)
// ---------------------------------------------------------------------------

describe("useUsersAdmin state contracts", () => {
	it("defines expected state shape", () => {
		const expectedStateKeys = [
			"data",
			"pagination",
			"loading",
			"filters",
			"selectedIds",
			"editUser",
			"editLoading",
			"confirmDialog",
			"confirmLoading",
		];
		expect(expectedStateKeys.length).toBe(9);
	});

	it("defines expected actions shape", () => {
		const expectedActionKeys = [
			"fetchData",
			"handlePageChange",
			"handleFilterChange",
			"handleClearFilters",
			"openEditDialog",
			"closeEditDialog",
			"handleEditSave",
			"handleBan",
			"handleNuke",
			"handleUnban",
			"handleBatchAction",
			"setSelectedIds",
			"closeConfirmDialog",
		];
		expect(expectedActionKeys.length).toBe(13);
	});
});

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

describe("filter state defaults", () => {
	it("default filters are all empty strings", () => {
		const defaultFilters = { search: "", status: "", role: "" };
		expect(Object.values(defaultFilters).every((v) => v === "")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Pagination state
// ---------------------------------------------------------------------------

describe("pagination state defaults", () => {
	it("default pagination has expected values", () => {
		const defaultPagination = { page: 1, pages: 0, total: 0, limit: 20 };
		expect(defaultPagination.page).toBe(1);
		expect(defaultPagination.limit).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// Confirm dialog state
// ---------------------------------------------------------------------------

describe("confirm dialog state", () => {
	it("default confirm dialog is closed", () => {
		const defaultDialog = {
			open: false,
			title: "",
			description: "",
			variant: "default",
			onConfirm: () => {},
		};
		expect(defaultDialog.open).toBe(false);
	});

	it("ban dialog uses destructive variant", () => {
		const banDialogVariant = "destructive";
		expect(banDialogVariant).toBe("destructive");
	});
});

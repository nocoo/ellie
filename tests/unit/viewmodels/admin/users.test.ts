import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	banUser,
	batchSetRole,
	batchSetStatus,
	buildUserSearchParams,
	fetchUser,
	fetchUsers,
	nukeUser,
	roleLabel,
	statusLabel,
	updateUser,
} from "../../../../apps/web/src/viewmodels/admin/users";

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

function mockJsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	mockFetchFn = mock(() =>
		Promise.resolve(
			mockJsonResponse({
				data: [],
				meta: { timestamp: 1711612800000, requestId: "r1", total: 0, page: 1, limit: 20, pages: 0 },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("buildUserSearchParams", () => {
	it("includes present values", () => {
		const params = buildUserSearchParams({ page: 2, limit: 20, username: "alice" });
		expect(params.page).toBe(2);
		expect(params.limit).toBe(20);
		expect(params.username).toBe("alice");
	});

	it("omits empty strings and nulls", () => {
		const params = buildUserSearchParams({ username: "", status: null, role: null });
		expect(params.username).toBeUndefined();
		expect(params.status).toBeUndefined();
		expect(params.role).toBeUndefined();
	});

	it("includes 0 as valid status/role", () => {
		const params = buildUserSearchParams({ status: 0, role: 0 });
		expect(params.status).toBe(0);
		expect(params.role).toBe(0);
	});
});

describe("roleLabel", () => {
	it("maps known roles", () => {
		expect(roleLabel(0)).toBe("Member");
		expect(roleLabel(1)).toBe("Admin");
		expect(roleLabel(2)).toBe("SuperMod");
		expect(roleLabel(3)).toBe("Mod");
	});

	it("defaults to Member for unknown", () => {
		expect(roleLabel(99)).toBe("Member");
	});
});

describe("statusLabel", () => {
	it("maps known statuses", () => {
		expect(statusLabel(0)).toBe("Active");
		expect(statusLabel(-1)).toBe("Banned");
		expect(statusLabel(-2)).toBe("Archived");
	});

	it("defaults to Active for unknown", () => {
		expect(statusLabel(5)).toBe("Active");
	});
});

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

describe("fetchUsers", () => {
	it("calls GET /api/admin/users with search params", async () => {
		await fetchUsers({ page: 1, limit: 20, username: "bob" });

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/users");
		expect(url).toContain("username=bob");
		expect(url).toContain("page=1");
	});
});

describe("fetchUser", () => {
	it("calls GET /api/admin/users/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: { uid: 42, username: "alice" },
					meta: { timestamp: 1711612800000, requestId: "r1" },
				}),
			),
		);

		const user = await fetchUser(42);
		expect(user.uid).toBe(42);
		expect(user.username).toBe("alice");

		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/users/42");
	});
});

describe("updateUser", () => {
	it("calls PATCH /api/admin/users/:id with body", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: { uid: 42, role: 1 },
					meta: { timestamp: 1711612800000, requestId: "r1" },
				}),
			),
		);

		await updateUser(42, { role: 1 });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42");
		expect(opts.method).toBe("PATCH");
	});
});

describe("banUser", () => {
	it("calls POST /api/admin/users/:id/ban", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { banned: true }, meta: {} })),
		);

		const result = await banUser(42, true);
		expect(result.banned).toBe(true);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/ban");
		expect(opts.method).toBe("POST");
	});
});

describe("nukeUser", () => {
	it("calls POST /api/admin/users/:id/nuke", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { nuked: true, deletedThreads: 5, deletedPosts: 30 }, meta: {} }),
			),
		);

		const result = await nukeUser(42);
		expect(result.nuked).toBe(true);
		expect(result.deletedThreads).toBe(5);

		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/users/42/nuke");
	});
});

describe("batchSetStatus", () => {
	it("calls POST /api/admin/users/batch-status", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3 }, meta: {} })),
		);

		const result = await batchSetStatus([1, 2, 3], -1);
		expect(result.affected).toBe(3);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/batch-status");
		expect(opts.body).toBe(JSON.stringify({ ids: [1, 2, 3], status: -1 }));
	});
});

describe("batchSetRole", () => {
	it("calls POST /api/admin/users/batch-role", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 2 }, meta: {} })),
		);

		const result = await batchSetRole([10, 20], 3);
		expect(result.affected).toBe(2);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/batch-role");
		expect(opts.body).toBe(JSON.stringify({ ids: [10, 20], role: 3 }));
	});
});

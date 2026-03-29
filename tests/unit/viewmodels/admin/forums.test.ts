import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	type ReorderItem,
	createForum,
	deleteForum,
	fetchForum,
	fetchForums,
	mergeForums,
	reorderForums,
	statusLabel,
	updateForum,
} from "../../../../apps/web/src/viewmodels/admin/forums";

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
				meta: { timestamp: 1711612800000, requestId: "r1", total: 0, page: 1, limit: 50, pages: 0 },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("statusLabel", () => {
	it("maps status values (Worker: 0=hidden, 1=active)", () => {
		expect(statusLabel(1)).toBe("Active");
		expect(statusLabel(0)).toBe("Hidden");
		expect(statusLabel(99)).toBe("Unknown");
	});
});

describe("fetchForums", () => {
	it("calls GET /api/admin/forums", async () => {
		await fetchForums();
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/forums");
	});
});

describe("fetchForum", () => {
	it("calls GET /api/admin/forums/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 5, name: "General" }, meta: {} })),
		);
		const forum = await fetchForum(5);
		expect(forum.id).toBe(5);
	});
});

describe("createForum", () => {
	it("calls POST /api/admin/forums", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 10, name: "New Forum", displayOrder: 1 }, meta: {} }),
			),
		);
		const forum = await createForum({ name: "New Forum", displayOrder: 1 });
		expect(forum.name).toBe("New Forum");
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ name: "New Forum", displayOrder: 1 }));
	});
});

describe("updateForum", () => {
	it("calls PATCH /api/admin/forums/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 5, name: "Updated" }, meta: {} })),
		);
		await updateForum(5, { name: "Updated" });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/5");
		expect(opts.method).toBe("PATCH");
	});
});

describe("deleteForum", () => {
	it("calls DELETE /api/admin/forums/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { deleted: true }, meta: {} })),
		);
		const result = await deleteForum(5);
		expect(result.deleted).toBe(true);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/5");
		expect(opts.method).toBe("DELETE");
	});
});

describe("mergeForums", () => {
	it("calls POST /api/admin/forums/:id/merge with targetForumId", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { merged: true, movedThreads: 15 }, meta: {} })),
		);
		const result = await mergeForums(3, 7);
		expect(result.merged).toBe(true);
		expect(result.movedThreads).toBe(15);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/3/merge");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ targetForumId: 7 }));
	});
});

describe("reorderForums", () => {
	it("calls POST /api/admin/forums/reorder with orders array", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { reordered: true }, meta: {} })),
		);
		const orders: ReorderItem[] = [
			{ id: 3, displayOrder: 0 },
			{ id: 1, displayOrder: 1 },
			{ id: 2, displayOrder: 2 },
		];
		const result = await reorderForums(orders);
		expect(result.reordered).toBe(true);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/reorder");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ orders }));
	});
});

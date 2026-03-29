import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	batchDeletePosts,
	buildPostSearchParams,
	deletePost,
	fetchPost,
	fetchPosts,
	updatePost,
} from "../../../../apps/web/src/viewmodels/admin/posts";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let mockFetchFn: ReturnType<typeof mock>;

function mockJsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.ADMIN_API_KEY = "test-key-b";
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
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
});

describe("buildPostSearchParams", () => {
	it("includes present values", () => {
		const params = buildPostSearchParams({ page: 1, limit: 20, content: "hello" });
		expect(params.page).toBe(1);
		expect(params.content).toBe("hello");
	});

	it("omits empty and null values", () => {
		const params = buildPostSearchParams({ authorName: "", threadId: undefined });
		expect(params.authorName).toBeUndefined();
		expect(params.threadId).toBeUndefined();
	});

	it("includes first filter when set", () => {
		const params = buildPostSearchParams({ first: 1 });
		expect(params.first).toBe(1);
	});

	it("omits first filter when undefined", () => {
		const params = buildPostSearchParams({});
		expect(params.first).toBeUndefined();
	});
});

describe("fetchPosts", () => {
	it("calls GET /api/admin/posts with params", async () => {
		await fetchPosts({ page: 2, content: "hello" });
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/posts");
		expect(url).toContain("content=hello");
	});
});

describe("fetchPost", () => {
	it("calls GET /api/admin/posts/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { pid: 10, content: "Test post" }, meta: {} })),
		);
		const post = await fetchPost(10);
		expect(post.pid).toBe(10);
	});
});

describe("updatePost", () => {
	it("calls PATCH /api/admin/posts/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { pid: 10, content: "Updated" }, meta: {} })),
		);
		await updatePost(10, { content: "Updated" });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/posts/10");
		expect(opts.method).toBe("PATCH");
	});
});

describe("deletePost", () => {
	it("calls DELETE /api/admin/posts/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { deleted: true }, meta: {} })),
		);
		const result = await deletePost(10);
		expect(result.deleted).toBe(true);
	});
});

describe("batchDeletePosts", () => {
	it("calls POST /api/admin/posts/batch-delete", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3, skipped: 1 }, meta: {} })),
		);
		const result = await batchDeletePosts([1, 2, 3, 4]);
		expect(result.affected).toBe(3);
		expect(result.skipped).toBe(1);
	});

	it("sends ids in request body", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 2, skipped: 0 }, meta: {} })),
		);
		await batchDeletePosts([5, 6]);
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.body).toBe(JSON.stringify({ ids: [5, 6] }));
	});
});

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	batchDeleteThreads,
	batchMoveThreads,
	buildThreadSearchParams,
	deleteThread,
	digestLabel,
	fetchThread,
	fetchThreads,
	stickyLabel,
	updateThread,
} from "../../../../apps/web/src/viewmodels/admin/threads";

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

describe("buildThreadSearchParams", () => {
	it("includes present values", () => {
		const params = buildThreadSearchParams({ page: 1, limit: 20, subject: "test" });
		expect(params.page).toBe(1);
		expect(params.subject).toBe("test");
	});

	it("omits empty and null values", () => {
		const params = buildThreadSearchParams({ authorName: "", forumId: undefined });
		expect(params.authorName).toBeUndefined();
		expect(params.forumId).toBeUndefined();
	});
});

describe("stickyLabel", () => {
	it("maps sticky levels", () => {
		expect(stickyLabel(0)).toBe("");
		expect(stickyLabel(1)).toBe("版块置顶");
		expect(stickyLabel(2)).toBe("全局置顶");
		expect(stickyLabel(3)).toBe("分类置顶");
	});
});

describe("digestLabel", () => {
	it("maps digest levels", () => {
		expect(digestLabel(0)).toBe("");
		expect(digestLabel(1)).toBe("精华 I");
		expect(digestLabel(2)).toBe("精华 II");
		expect(digestLabel(3)).toBe("精华 III");
	});
});

describe("fetchThreads", () => {
	it("calls GET /api/admin/threads with params", async () => {
		await fetchThreads({ page: 2, subject: "hello" });
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/threads");
		expect(url).toContain("subject=hello");
	});
});

describe("fetchThread", () => {
	it("calls GET /api/admin/threads/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 10, subject: "Test" }, meta: {} })),
		);
		const thread = await fetchThread(10);
		expect(thread.id).toBe(10);
	});
});

describe("updateThread", () => {
	it("calls PATCH /api/admin/threads/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 10, sticky: 1 }, meta: {} })),
		);
		await updateThread(10, { sticky: 1 });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/threads/10");
		expect(opts.method).toBe("PATCH");
	});
});

describe("deleteThread", () => {
	it("calls DELETE /api/admin/threads/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { deleted: true, deletedPosts: 5 }, meta: {} })),
		);
		const result = await deleteThread(10);
		expect(result.deleted).toBe(true);
	});
});

describe("batchDeleteThreads", () => {
	it("calls POST /api/admin/threads/batch-delete", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3 }, meta: {} })),
		);
		const result = await batchDeleteThreads([1, 2, 3]);
		expect(result.affected).toBe(3);
	});
});

describe("batchMoveThreads", () => {
	it("calls POST /api/admin/threads/batch-move", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 2 }, meta: {} })),
		);
		const result = await batchMoveThreads([1, 2], 5);
		expect(result.affected).toBe(2);
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.body).toBe(JSON.stringify({ ids: [1, 2], forumId: 5 }));
	});
});

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as forumApiModule from "../../../../apps/web/src/lib/forum-api";
import { loadSearchResults } from "../../../../apps/web/src/viewmodels/forum/search.server";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockForumApi(overrides: {
	get?: typeof forumApiModule.forumApi.get;
	getCursor?: typeof forumApiModule.forumApi.getCursor;
}) {
	if (overrides.get) {
		spyOn(forumApiModule.forumApi, "get").mockImplementation(overrides.get);
	}
	if (overrides.getCursor) {
		spyOn(forumApiModule.forumApi, "getCursor").mockImplementation(overrides.getCursor);
	}
}

function createMockThread(id: number) {
	return {
		id,
		forumId: 1,
		authorId: 100,
		authorName: "Test User",
		authorAvatar: "",
		subject: `Test Thread ${id}`,
		createdAt: 1700000000,
		lastPostAt: 1700000000 + id,
		lastPoster: "Test User",
		lastPosterId: 100,
		lastPosterAvatar: "",
		replies: 0,
		views: 0,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		typeName: "",
	};
}

// ---------------------------------------------------------------------------
// loadSearchResults — isSearchEnabled
// ---------------------------------------------------------------------------

describe("loadSearchResults — isSearchEnabled via settings", () => {
	afterEach(() => {
		mock.restore();
	});

	it("returns disabled: true when general.search.enabled is false", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": false },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
		});

		const result = await loadSearchResults({ query: "test" });

		expect(result.disabled).toBe(true);
		expect(result.results.items).toHaveLength(0);
	});

	it("proceeds normally when general.search.enabled is true", async () => {
		const mockThread = createMockThread(1);
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async () => ({
				data: [mockThread],
				meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
			}),
		});

		const result = await loadSearchResults({ query: "test" });

		expect(result.disabled).toBeUndefined();
		expect(result.results.items).toHaveLength(1);
	});

	it("proceeds normally when setting key is missing (default true)", async () => {
		const mockThread = createMockThread(1);
		mockForumApi({
			get: async () => ({
				data: {},
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async () => ({
				data: [mockThread],
				meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
			}),
		});

		const result = await loadSearchResults({ query: "test" });

		expect(result.disabled).toBeUndefined();
		expect(result.results.items).toHaveLength(1);
	});

	it("fails open (search enabled) when settings API errors", async () => {
		const mockThread = createMockThread(1);
		mockForumApi({
			get: async () => {
				throw new Error("Network error");
			},
			getCursor: async () => ({
				data: [mockThread],
				meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
			}),
		});

		const result = await loadSearchResults({ query: "test" });

		// Should proceed with search, not return disabled
		expect(result.disabled).toBeUndefined();
		expect(result.results.items).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// loadSearchResults — empty query handling
// ---------------------------------------------------------------------------

describe("loadSearchResults — empty query handling", () => {
	afterEach(() => {
		mock.restore();
	});

	it("returns empty results for empty query string", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
		});

		const result = await loadSearchResults({ query: "" });

		expect(result.query).toBe("");
		expect(result.results.items).toHaveLength(0);
		expect(result.disabled).toBeUndefined();
	});

	it("returns empty results for whitespace-only query", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
		});

		const result = await loadSearchResults({ query: "   " });

		expect(result.query).toBe("");
		expect(result.results.items).toHaveLength(0);
	});

	it("returns empty results for single character query", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
		});

		const result = await loadSearchResults({ query: "a" });

		expect(result.query).toBe("a");
		expect(result.results.items).toHaveLength(0);
	});

	it("shows disabled state on empty query when search is disabled", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": false },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
		});

		// This is the key test: even with empty query, disabled state should be detected
		const result = await loadSearchResults({ query: "" });

		expect(result.disabled).toBe(true);
		expect(result.results.items).toHaveLength(0);
	});

	it("shows disabled state on page load (no query) when search is disabled", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": false },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
		});

		const result = await loadSearchResults({});

		expect(result.disabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// loadSearchResults — search results
// ---------------------------------------------------------------------------

describe("loadSearchResults — search results", () => {
	afterEach(() => {
		mock.restore();
	});

	it("returns search results for valid query", async () => {
		const mockThreads = [createMockThread(1), createMockThread(2)];
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async () => ({
				data: mockThreads,
				meta: { timestamp: Date.now(), requestId: "test", nextCursor: null, total: 2 },
			}),
		});

		const result = await loadSearchResults({ query: "test" });

		expect(result.query).toBe("test");
		expect(result.results.items).toHaveLength(2);
		expect(result.results.total).toBe(2);
	});

	it("returns nextCursor for pagination", async () => {
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async () => ({
				data: [createMockThread(1)],
				meta: { timestamp: Date.now(), requestId: "test", nextCursor: "abc123", total: 10 },
			}),
		});

		const result = await loadSearchResults({ query: "test" });

		expect(result.results.nextCursor).toBe("abc123");
		expect(result.results.prevCursor).toBeNull(); // FTS5 is forward-only
	});

	it("passes cursor parameter to API", async () => {
		let capturedParams: Record<string, unknown> | undefined;
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async (_path, params) => {
				capturedParams = params as Record<string, unknown>;
				return {
					data: [],
					meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
				};
			},
		});

		await loadSearchResults({ query: "test", cursor: "cursor123" });

		expect(capturedParams?.cursor).toBe("cursor123");
	});

	it("uses default limit of 20", async () => {
		let capturedParams: Record<string, unknown> | undefined;
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async (_path, params) => {
				capturedParams = params as Record<string, unknown>;
				return {
					data: [],
					meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
				};
			},
		});

		await loadSearchResults({ query: "test" });

		expect(capturedParams?.limit).toBe(20);
	});

	it("respects custom limit parameter", async () => {
		let capturedParams: Record<string, unknown> | undefined;
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async (_path, params) => {
				capturedParams = params as Record<string, unknown>;
				return {
					data: [],
					meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
				};
			},
		});

		await loadSearchResults({ query: "test", limit: 50 });

		expect(capturedParams?.limit).toBe(50);
	});

	it("trims query before sending to API", async () => {
		let capturedParams: Record<string, unknown> | undefined;
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async (_path, params) => {
				capturedParams = params as Record<string, unknown>;
				return {
					data: [],
					meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
				};
			},
		});

		await loadSearchResults({ query: "  test  " });

		expect(capturedParams?.q).toBe("test");
	});
});

// ---------------------------------------------------------------------------
// loadSearchResults — does NOT call search API when disabled
// ---------------------------------------------------------------------------

describe("loadSearchResults — API call behavior", () => {
	afterEach(() => {
		mock.restore();
	});

	it("does not call search API when search is disabled", async () => {
		let searchApiCalled = false;
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": false },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async () => {
				searchApiCalled = true;
				return {
					data: [],
					meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
				};
			},
		});

		await loadSearchResults({ query: "test" });

		expect(searchApiCalled).toBe(false);
	});

	it("does not call search API for short queries", async () => {
		let searchApiCalled = false;
		mockForumApi({
			get: async () => ({
				data: { "general.search.enabled": true },
				meta: { timestamp: Date.now(), requestId: "test" },
			}),
			getCursor: async () => {
				searchApiCalled = true;
				return {
					data: [],
					meta: { timestamp: Date.now(), requestId: "test", nextCursor: null },
				};
			},
		});

		await loadSearchResults({ query: "a" });

		expect(searchApiCalled).toBe(false);
	});
});

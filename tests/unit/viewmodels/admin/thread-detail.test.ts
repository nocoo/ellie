import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Post } from "../../../../apps/web/src/viewmodels/admin/posts";
import {
	enrichPosts,
	fetchThreadPosts,
	loadThreadDetail,
	uniqueAuthorIds,
} from "../../../../apps/web/src/viewmodels/admin/thread-detail";
import type { User } from "../../../../apps/web/src/viewmodels/admin/users";

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

function makePost(overrides: Partial<Post> = {}): Post {
	return {
		id: 1,
		threadId: 100,
		forumId: 10,
		content: "Hello world",
		authorId: 42,
		authorName: "alice",
		isFirst: false,
		position: 1,
		createdAt: 1700000000,
		...overrides,
	};
}

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 42,
		username: "alice",
		email: "alice@example.com",
		avatar: "https://example.com/alice.jpg",
		role: 0,
		status: 0,
		threads: 10,
		posts: 100,
		credits: 50,
		regDate: 1600000000,
		lastLogin: 1700000000,
		...overrides,
	};
}

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
				meta: { timestamp: 1711612800000, requestId: "r1" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// uniqueAuthorIds
// ---------------------------------------------------------------------------

describe("uniqueAuthorIds", () => {
	it("returns unique author IDs", () => {
		const posts = [
			makePost({ authorId: 1 }),
			makePost({ authorId: 2 }),
			makePost({ authorId: 1 }),
			makePost({ authorId: 3 }),
		];
		expect(uniqueAuthorIds(posts).sort()).toEqual([1, 2, 3]);
	});

	it("returns empty for no posts", () => {
		expect(uniqueAuthorIds([])).toEqual([]);
	});

	it("returns single ID for one post", () => {
		expect(uniqueAuthorIds([makePost({ authorId: 99 })])).toEqual([99]);
	});
});

// ---------------------------------------------------------------------------
// enrichPosts
// ---------------------------------------------------------------------------

describe("enrichPosts", () => {
	it("attaches matching author to each post", () => {
		const posts = [makePost({ id: 1, authorId: 42 }), makePost({ id: 2, authorId: 43 })];
		const authors = [
			makeUser({ id: 42, username: "alice" }),
			makeUser({ id: 43, username: "bob" }),
		];

		const enriched = enrichPosts(posts, authors);
		expect(enriched).toHaveLength(2);
		expect(enriched[0]?.author?.username).toBe("alice");
		expect(enriched[1]?.author?.username).toBe("bob");
	});

	it("sets author to null for unknown authorId", () => {
		const posts = [makePost({ authorId: 999 })];
		const authors = [makeUser({ id: 42 })];

		const enriched = enrichPosts(posts, authors);
		expect(enriched[0]?.author).toBeNull();
	});

	it("preserves all post fields", () => {
		const post = makePost({ id: 5, content: "test content", position: 3, isFirst: true });
		const enriched = enrichPosts([post], [makeUser({ id: 42 })]);

		expect(enriched[0]?.id).toBe(5);
		expect(enriched[0]?.content).toBe("test content");
		expect(enriched[0]?.position).toBe(3);
		expect(enriched[0]?.isFirst).toBe(true);
	});

	it("handles empty posts array", () => {
		expect(enrichPosts([], [makeUser()])).toEqual([]);
	});

	it("handles empty authors array", () => {
		const enriched = enrichPosts([makePost()], []);
		expect(enriched[0]?.author).toBeNull();
	});

	it("multiple posts same author share same reference", () => {
		const posts = [makePost({ id: 1, authorId: 42 }), makePost({ id: 2, authorId: 42 })];
		const authors = [makeUser({ id: 42 })];

		const enriched = enrichPosts(posts, authors);
		expect(enriched[0]?.author).toBe(enriched[1]?.author);
	});
});

// ---------------------------------------------------------------------------
// fetchThreadPosts
// ---------------------------------------------------------------------------

describe("fetchThreadPosts", () => {
	it("fetches posts for a thread with default pagination", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: [makePost({ id: 1, threadId: 5 }), makePost({ id: 2, threadId: 5 })],
					meta: {
						timestamp: 1711612800000,
						requestId: "r1",
						total: 2,
						page: 1,
						limit: 20,
						pages: 1,
					},
				}),
			),
		);

		const result = await fetchThreadPosts(5);
		expect(result.data).toHaveLength(2);
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/posts");
		expect(url).toContain("threadId=5");
		expect(url).toContain("sort=position_asc");
	});

	it("passes custom page and limit", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: [],
					meta: {
						timestamp: 1711612800000,
						requestId: "r1",
						total: 0,
						page: 2,
						limit: 10,
						pages: 0,
					},
				}),
			),
		);

		await fetchThreadPosts(5, 2, 10);
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("page=2");
		expect(url).toContain("limit=10");
	});
});

// ---------------------------------------------------------------------------
// loadThreadDetail
// ---------------------------------------------------------------------------

describe("loadThreadDetail", () => {
	it("loads thread with enriched posts", async () => {
		let callCount = 0;
		mockFetchFn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				// First call: fetchThread
				return Promise.resolve(
					mockJsonResponse({
						data: {
							id: 5,
							subject: "Test Thread",
							forumId: 10,
							authorId: 1,
							authorName: "alice",
							replies: 5,
							views: 100,
							sticky: 0,
							closed: 0,
							digest: 0,
							highlight: 0,
							lastPostAt: 1700000000,
							createdAt: 1700000000,
						},
						meta: { timestamp: 1711612800000, requestId: "r1" },
					}),
				);
			}
			if (callCount === 2) {
				// Second call: fetchThreadPosts
				return Promise.resolve(
					mockJsonResponse({
						data: [makePost({ id: 1, threadId: 5, authorId: 42 })],
						meta: {
							timestamp: 1711612800000,
							requestId: "r2",
							total: 1,
							page: 1,
							limit: 20,
							pages: 1,
						},
					}),
				);
			}
			// Third call: fetchUsersByIds
			return Promise.resolve(
				mockJsonResponse({
					data: [makeUser({ id: 42, username: "alice" })],
					meta: { timestamp: 1711612800000, requestId: "r3" },
				}),
			);
		});

		const result = await loadThreadDetail(5);
		expect(result.thread.subject).toBe("Test Thread");
		expect(result.posts).toHaveLength(1);
		expect(result.posts[0]?.author?.username).toBe("alice");
		expect(result.pagination.total).toBe(1);
		expect(result.pagination.page).toBe(1);
		expect(result.pagination.limit).toBe(20);
		expect(result.pagination.pages).toBe(1);
	});
});

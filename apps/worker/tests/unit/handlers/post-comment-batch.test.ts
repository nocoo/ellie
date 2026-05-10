import { describe, expect, it } from "vitest";
import { batchByPostIds } from "../../../src/handlers/post-comment";
import { createMockDb, makeEnv } from "../../helpers";

describe("batchByPostIds (post-comments)", () => {
	function makeRequest(body: unknown): Request {
		return new Request("https://example.com/api/v1/post-comments/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("should return 400 for invalid JSON body", async () => {
		const env = makeEnv();
		const request = new Request("https://example.com/api/v1/post-comments/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		const response = await batchByPostIds(request, env);
		expect(response.status).toBe(400);
	});

	it("should return 400 for missing threadId", async () => {
		const env = makeEnv();
		const response = await batchByPostIds(makeRequest({ postIds: [1, 2] }), env);
		expect(response.status).toBe(400);
		const data = (await response.json()) as {
			error: { code: string; details?: { message: string } };
		};
		expect(data.error.code).toBe("INVALID_BODY");
		expect(data.error.details?.message).toContain("threadId");
	});

	it("should return empty array for empty postIds", async () => {
		const env = makeEnv();
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [] }), env);
		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toEqual([]);
	});

	it("should return 400 for too many post IDs", async () => {
		const env = makeEnv();
		const postIds = Array.from({ length: 101 }, (_, i) => i + 1);
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds }), env);
		expect(response.status).toBe(400);
		const data = (await response.json()) as {
			error: { code: string; details?: { message: string } };
		};
		expect(data.error.details?.message).toContain("max");
	});

	it("should deduplicate post IDs", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "public" },
			},
			allResults: {
				"FROM post_comments pc": [],
			},
		});
		const env = makeEnv({ DB: db });

		await batchByPostIds(makeRequest({ threadId: 1, postIds: [10, 10, 10] }), env);

		// Comments query should be bound with deduplicated postId + threadId
		const commentsQuery = calls.find((c) => c.sql.includes("FROM post_comments pc"));
		expect(commentsQuery).toBeDefined();
		expect(commentsQuery?.params).toEqual([10, 1]);
	});

	it("should return 404 when thread is hidden (sticky < 0)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: -1, status: 1, visibility: "public" },
			},
			allResults: {
				"FROM post_comments pc": [],
			},
		});
		const env = makeEnv({ DB: db });
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);
		expect(response.status).toBe(404);
	});

	it("should return 404 when forum is inactive", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 0, visibility: "public" },
			},
			allResults: {
				"FROM post_comments pc": [],
			},
		});
		const env = makeEnv({ DB: db });
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);
		expect(response.status).toBe(404);
	});

	it("should return 403 when forum visibility restricts access", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "members" },
			},
			allResults: {
				"FROM post_comments pc": [],
			},
		});
		const env = makeEnv({ DB: db });
		// No auth header → anonymous user cannot view members-only forum
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);
		expect(response.status).toBe(403);
	});

	it("should return comments for multiple posts in a single request", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "public" },
			},
			allResults: {
				"FROM post_comments pc": [
					{
						id: 1,
						thread_id: 1,
						post_id: 10,
						author_id: 100,
						author_name: "alice",
						content: "Nice!",
						score: 0,
						reply_post_id: 0,
						created_at: 1711540800,
					},
					{
						id: 2,
						thread_id: 1,
						post_id: 20,
						author_id: 200,
						author_name: "bob",
						content: "Great!",
						score: 0,
						reply_post_id: 0,
						created_at: 1711540801,
					},
				],
			},
		});
		const env = makeEnv({ DB: db });
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10, 20] }), env);
		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toHaveLength(2);
	});

	it("should map comments to camelCase", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "public" },
			},
			allResults: {
				"FROM post_comments pc": [
					{
						id: 5,
						thread_id: 1,
						post_id: 10,
						author_id: 100,
						author_name: "alice",
						content: "Hello",
						score: 1,
						reply_post_id: 0,
						created_at: 1711540800,
					},
				],
			},
		});
		const env = makeEnv({ DB: db });
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);
		const data = (await response.json()) as { data: Array<Record<string, unknown>> };
		expect(data.data[0].postId).toBe(10);
		expect(data.data[0].authorId).toBe(100);
		expect(data.data[0].authorName).toBe("alice");
		expect(data.data[0].createdAt).toBe(1711540800);
		expect(data.data[0].replyPostId).toBe(0);
		// No snake_case leaks
		expect(data.data[0].post_id).toBeUndefined();
		expect(data.data[0].author_id).toBeUndefined();
		expect(data.data[0].author_name).toBeUndefined();
		expect(data.data[0].created_at).toBeUndefined();
		expect(data.data[0].reply_post_id).toBeUndefined();
	});

	it("should silently exclude posts not belonging to the thread", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "public" },
			},
			allResults: {
				// Only post 10 belongs to thread 1; post 99 does not (JOIN filters it)
				"FROM post_comments pc": [
					{
						id: 1,
						thread_id: 1,
						post_id: 10,
						author_id: 100,
						author_name: "alice",
						content: "Valid",
						score: 0,
						reply_post_id: 0,
						created_at: 1711540800,
					},
				],
			},
		});
		const env = makeEnv({ DB: db });
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10, 99] }), env);
		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toHaveLength(1);
	});

	it("should only issue 2 D1 queries for N posts (no N+1)", async () => {
		const postIds = [10, 20, 30, 40, 50];
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "public" },
			},
			allResults: {
				"FROM post_comments pc": [],
			},
		});
		const env = makeEnv({ DB: db });

		await batchByPostIds(makeRequest({ threadId: 1, postIds }), env);

		// Exactly 2 queries regardless of how many posts (anonymous, no auth DB lookup):
		// 1. thread+forum visibility JOIN
		// 2. comments JOIN posts
		expect(calls.length).toBe(2);
	});

	it("should return empty array when no postIds match the thread", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads t": { forum_id: 1, sticky: 0, status: 1, visibility: "public" },
			},
			allResults: {
				// No comments returned because posts don't belong to thread
				"FROM post_comments pc": [],
			},
		});
		const env = makeEnv({ DB: db });
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [999, 888] }), env);
		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toEqual([]);
	});
});

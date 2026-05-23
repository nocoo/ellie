import { describe, expect, it } from "vitest";
import { batchByPostIds } from "../../../src/handlers/attachment";
import type { Env } from "../../../src/lib/env";
import { TEST_JWT_SECRET, createMockDb, createMockKV, makeD1AttachmentRow } from "../../helpers";

describe("batchByPostIds", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
	};

	function makeRequest(body: unknown): Request {
		return new Request("https://example.com/api/v1/posts/attachments/batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("should return attachments for multiple posts in a single request", async () => {
		const att1 = makeD1AttachmentRow({ id: 1, post_id: 10, thread_id: 1 });
		const att2 = makeD1AttachmentRow({ id: 2, post_id: 10, thread_id: 1, filename: "b.jpg" });
		const att3 = makeD1AttachmentRow({ id: 3, post_id: 20, thread_id: 1 });

		const { db } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
				"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
			},
			allResults: {
				"FROM attachments a": [att1, att2, att3],
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10, 20] }), env);

		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toHaveLength(3);
	});

	it("should return empty array for empty postIds", async () => {
		const { db } = createMockDb();
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [] }), env);

		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toEqual([]);
	});

	it("should deduplicate post IDs", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
				"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
			},
			allResults: {
				"FROM attachments a": [],
			},
		});
		const env = { ...mockEnv, DB: db };

		await batchByPostIds(makeRequest({ threadId: 1, postIds: [10, 10, 10] }), env);

		// The combined attachments+posts JOIN should be bound with the
		// deduplicated post ids followed by threadId.
		const attQuery = calls.find((c) => c.sql.includes("FROM attachments a"));
		expect(attQuery).toBeDefined();
		expect(attQuery?.params).toEqual([10, 1]);
	});

	it("should return 400 for missing threadId", async () => {
		const { db } = createMockDb();
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ postIds: [1, 2] }), env);

		expect(response.status).toBe(400);
	});

	it("should return 400 for too many post IDs", async () => {
		const { db } = createMockDb();
		const env = { ...mockEnv, DB: db };

		const postIds = Array.from({ length: 101 }, (_, i) => i + 1);
		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds }), env);

		expect(response.status).toBe(400);
		const data = (await response.json()) as {
			error: { code: string; details?: { message: string } };
		};
		expect(data.error.details?.message).toContain("max");
	});

	it("should return 404 when thread is hidden (sticky < 0)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: -1, author_id: 10 },
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);

		expect(response.status).toBe(404);
	});

	it("should return 404 when forum is inactive", async () => {
		const { db } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
				"FROM forums WHERE id": { status: 0, visibility: "public", moderator_ids: "" },
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);

		expect(response.status).toBe(404);
	});

	it("should silently exclude posts not belonging to the thread", async () => {
		const att1 = makeD1AttachmentRow({ id: 1, post_id: 10 });
		const { db } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
				"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
			},
			allResults: {
				// Only post 10 belongs to thread 1; post 99 does not
				"FROM attachments a": [att1],
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10, 99] }), env);

		expect(response.status).toBe(200);
		const data = (await response.json()) as { data: unknown[] };
		expect(data.data).toHaveLength(1);
	});

	it("should map attachments to camelCase", async () => {
		const att = makeD1AttachmentRow({
			id: 5,
			post_id: 10,
			thread_id: 1,
			is_image: 1,
			has_thumb: 1,
		});
		const { db } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
				"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
			},
			allResults: {
				"FROM attachments a": [att],
			},
		});
		const env = { ...mockEnv, DB: db };

		const response = await batchByPostIds(makeRequest({ threadId: 1, postIds: [10] }), env);

		const data = (await response.json()) as { data: Array<Record<string, unknown>> };
		expect(data.data[0].postId).toBe(10);
		expect(data.data[0].isImage).toBe(true);
		expect(data.data[0].hasThumb).toBe(true);
		// No snake_case leaks
		expect(data.data[0].post_id).toBeUndefined();
		expect(data.data[0].is_image).toBeUndefined();
	});

	it("should only issue 3 D1 queries for N posts (no N+1)", async () => {
		const postIds = [10, 20, 30, 40, 50];
		const { db, calls } = createMockDb({
			firstResults: {
				"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
				"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
			},
			allResults: {
				"SELECT id FROM posts WHERE id IN": postIds.map((id) => ({ id })),
				"FROM attachments a": [],
			},
		});
		const env = { ...mockEnv, DB: db };

		await batchByPostIds(makeRequest({ threadId: 1, postIds }), env);

		// Exactly 3 queries regardless of how many posts:
		// 1. SELECT forum_id, sticky FROM threads (thread check)
		// 2. SELECT status, visibility FROM forums (forum check)
		// 3. JOIN attachments x posts (combined post-validation + fetch)
		expect(calls.length).toBe(3);
	});
});

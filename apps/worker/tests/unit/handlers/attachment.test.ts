import { describe, expect, it } from "vitest";
import { listByPost } from "../../../src/handlers/attachment";
import type { Env } from "../../../src/lib/env";
import { createMockDb, createMockKV, makeD1AttachmentRow, TEST_JWT_SECRET } from "../../helpers";

describe("attachment handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
	};

	describe("listByPost", () => {
		it("should return attachments for a post", async () => {
			const row1 = makeD1AttachmentRow({ id: 1, post_id: 42 });
			const row2 = makeD1AttachmentRow({ id: 2, post_id: 42, filename: "doc.pdf", is_image: 0 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
				},
				allResults: {
					"SELECT * FROM attachments WHERE post_id": [row1, row2],
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/42/attachments"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(2);
			expect(data.data[0].id).toBe(1);
			expect(data.data[0].isImage).toBe(true);
			expect(data.data[1].id).toBe(2);
			expect(data.data[1].isImage).toBe(false);
		});

		it("should return empty array when no attachments", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
				},
				allResults: {
					"SELECT * FROM attachments WHERE post_id": [],
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/99/attachments"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual([]);
		});

		it("should map snake_case to camelCase", async () => {
			const row = makeD1AttachmentRow({ thread_id: 5, post_id: 10, author_id: 100, has_thumb: 1 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 5, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
				},
				allResults: {
					"SELECT * FROM attachments WHERE post_id": [row],
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/10/attachments"),
				env,
			);

			const data = await response.json();
			const att = data.data[0];
			expect(att.threadId).toBe(5);
			expect(att.postId).toBe(10);
			expect(att.authorId).toBe(100);
			expect(att.hasThumb).toBe(true);
			// No snake_case leaks
			expect(att.thread_id).toBeUndefined();
			expect(att.post_id).toBeUndefined();
			expect(att.has_thumb).toBeUndefined();
		});

		it("should include CORS headers", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
				},
				allResults: {
					"SELECT * FROM attachments WHERE post_id": [],
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/1/attachments", {
					headers: { Origin: "http://localhost:3000" },
				}),
				env,
			);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});

		it("should include metadata in response", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "" },
				},
				allResults: {
					"SELECT * FROM attachments WHERE post_id": [],
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/1/attachments"),
				env,
			);

			const data = (await response.json()) as { meta: { timestamp: number; requestId: string } };
			expect(typeof data.meta.timestamp).toBe("number");
			expect(data.meta.timestamp).toBeGreaterThan(0);
			expect(typeof data.meta.requestId).toBe("string");
			expect(data.meta.requestId.length).toBeGreaterThan(0);
		});

		// ─── Error branches ──────────────────────────────────────────

		it("should return 400 for invalid post ID", async () => {
			const { db } = createMockDb();
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/abc/attachments"),
				env,
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should return 400 for zero post ID", async () => {
			const { db } = createMockDb();
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/0/attachments"),
				env,
			);

			expect(response.status).toBe(400);
		});

		it("should return 404 when post not found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": null,
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/99/attachments"),
				env,
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should return 404 when post is invisible", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 1 },
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(404);
		});

		it("should return 404 when thread is hidden (sticky < 0)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: -1, author_id: 10 },
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: { code: string } };
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should return 404 for anon viewer on moderated thread (sticky=-2)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: -2, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "public", moderator_ids: "50" },
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: { code: string } };
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should return 404 when thread not found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 99, invisible: 0 },
					"FROM threads WHERE id": null,
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: { code: string } };
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should return 404 when forum is inactive (status <= 0)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 0, visibility: "public", moderator_ids: "" },
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(404);
			const data = (await response.json()) as { error: { code: string } };
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should return 404 when forum is paused (status === 2)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 2, visibility: "public", moderator_ids: "" },
				},
			});
			const env = { ...mockEnv, DB: db };

			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(404);
		});

		it("should return 403 when visibility check fails (members-only, no auth)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT thread_id, invisible FROM posts WHERE id": { thread_id: 1, invisible: 0 },
					"FROM threads WHERE id": { forum_id: 1, sticky: 0, author_id: 10 },
					"FROM forums WHERE id": { status: 1, visibility: "members", moderator_ids: "" },
				},
			});
			const env = { ...mockEnv, DB: db };

			// No auth header → anonymous user cannot access members-only forum
			const response = await listByPost(
				new Request("https://example.com/api/v1/posts/5/attachments"),
				env,
			);

			expect(response.status).toBe(403);
			const data = await response.json();
			expect(data.error.code).toBe("FORBIDDEN");
		});
	});
});

import { describe, expect, it } from "bun:test";
import { listByPost } from "../../../src/handlers/attachment";
import type { Env } from "../../../src/lib/env";
import { TEST_JWT_SECRET, createMockDb, createMockKV, makeD1AttachmentRow } from "../../helpers";

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
					"SELECT forum_id, sticky FROM threads WHERE id": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums WHERE id": { status: 1, visibility: "public" },
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
					"SELECT forum_id, sticky FROM threads WHERE id": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums WHERE id": { status: 1, visibility: "public" },
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
					"SELECT forum_id, sticky FROM threads WHERE id": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums WHERE id": { status: 1, visibility: "public" },
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
					"SELECT forum_id, sticky FROM threads WHERE id": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums WHERE id": { status: 1, visibility: "public" },
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
					"SELECT forum_id, sticky FROM threads WHERE id": { forum_id: 1, sticky: 0 },
					"SELECT status, visibility FROM forums WHERE id": { status: 1, visibility: "public" },
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

			const data = await response.json();
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});
	});
});

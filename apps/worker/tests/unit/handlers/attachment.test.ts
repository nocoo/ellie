import { describe, expect, it, mock } from "bun:test";
import { listByPost } from "../../../src/handlers/attachment";
import type { Env } from "../../../src/lib/env";
import { TEST_JWT_SECRET, makeD1AttachmentRow } from "../../helpers";

describe("attachment handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: {} as KVNamespace,
	};

	describe("listByPost", () => {
		it("should return attachments for a post", async () => {
			const row1 = makeD1AttachmentRow({ id: 1, post_id: 42 });
			const row2 = makeD1AttachmentRow({ id: 2, post_id: 42, filename: "doc.pdf", is_image: 0 });
			const allSpy = mock(() => Promise.resolve({ results: [row1, row2] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const db = { prepare: mock(() => ({ bind: bindSpy })) } as unknown as D1Database;
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
			expect(bindSpy).toHaveBeenCalledWith(42);
		});

		it("should return empty array when no attachments", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const db = { prepare: mock(() => ({ bind: bindSpy })) } as unknown as D1Database;
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
			const allSpy = mock(() => Promise.resolve({ results: [row] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const db = { prepare: mock(() => ({ bind: bindSpy })) } as unknown as D1Database;
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
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const db = { prepare: mock(() => ({ bind: bindSpy })) } as unknown as D1Database;
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
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const db = { prepare: mock(() => ({ bind: bindSpy })) } as unknown as D1Database;
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

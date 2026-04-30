import { describe, expect, it } from "vitest";
import { list, remove } from "../../../../src/handlers/admin/attachment";
import { createAdminRequest, createMockDb, makeD1AttachmentRow, makeEnv } from "../../../helpers";

describe("admin attachment handlers", () => {
	describe("list", () => {
		it("should list attachments with pagination", async () => {
			const rows = [makeD1AttachmentRow({ id: 1 }), makeD1AttachmentRow({ id: 2 })];
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 2 } },
				allResults: { "SELECT * FROM attachments": rows },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toHaveLength(2);
			expect(body.meta.total).toBe(2);
			expect(body.meta.page).toBe(1);
		});

		it("should filter by postId", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 1 } },
				allResults: { "SELECT * FROM attachments": [makeD1AttachmentRow({ post_id: 42 })] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments?postId=42");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("post_id = ?");
		});

		it("should filter by isImage=true", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 0 } },
				allResults: { "SELECT * FROM attachments": [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments?isImage=true");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("is_image = 1");
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments?page=0");

			const response = await list(request, env);

			expect(response.status).toBe(400);
		});

		it("should filter by threadId", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 0 } },
				allResults: { "SELECT * FROM attachments": [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments?threadId=10");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("thread_id = ?");
		});

		it("should filter by authorId", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 0 } },
				allResults: { "SELECT * FROM attachments": [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments?authorId=3");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("author_id = ?");
		});

		it("should filter by isImage=false", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 0 } },
				allResults: { "SELECT * FROM attachments": [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/attachments?isImage=false");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("is_image = 0");
		});
	});

	describe("remove", () => {
		it("should delete attachment", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM attachments WHERE id": makeD1AttachmentRow({ id: 5 }) },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("DELETE", "/api/admin/attachments/5");

			const response = await remove(request, env);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.deleted).toBe(true);
			expect(body.data.id).toBe(5);
		});

		it("should return 404 for non-existent attachment", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM attachments WHERE id": null },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("DELETE", "/api/admin/attachments/999");

			const response = await remove(request, env);

			expect(response.status).toBe(404);
		});
	});
});

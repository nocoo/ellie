import { describe, expect, it } from "vitest";
import * as announcement from "../../../../src/handlers/admin/announcement";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

describe("admin announcement handlers", () => {
	// ─── list ───────────────────────────────────────────────────────

	describe("list", () => {
		it("should return paginated announcements", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 1 } },
				allResults: {
					SELECT: [
						{
							id: 1,
							title: "Welcome",
							content: "Hello everyone",
							forum_ids: "",
							sticky: 1,
							start_at: null,
							end_at: null,
							status: 1,
							author_id: 1,
							author_name: "admin",
							created_at: 1711540800,
							updated_at: 1711540800,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements");
			const response = await announcement.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: { title: string }[];
				meta: { total: number };
			};
			expect(body.data).toHaveLength(1);
			expect(body.data[0].title).toBe("Welcome");
			expect(body.meta.total).toBe(1);
		});

		it("should filter by status", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements?status=0");
			const response = await announcement.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter active announcements", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements?active=true");
			const response = await announcement.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by forumId", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements?forumId=5");
			const response = await announcement.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements?page=0");
			const response = await announcement.list(request, env);
			expect(response.status).toBe(400);
		});
	});

	// ─── getById ────────────────────────────────────────────────────

	describe("getById", () => {
		it("should return 404 for non-existent announcement", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements/99");
			const response = await announcement.getById(request, env);
			expect(response.status).toBe(404);
		});

		it("should return announcement by id", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						title: "Test",
						content: "Content",
						forum_ids: "1,2",
						sticky: 0,
						start_at: null,
						end_at: null,
						status: 1,
						author_id: 1,
						author_name: "admin",
						created_at: 1711540800,
						updated_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/announcements/1");
			const response = await announcement.getById(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { id: number; title: string } };
			expect(body.data.id).toBe(1);
			expect(body.data.title).toBe("Test");
		});
	});

	// ─── create ─────────────────────────────────────────────────────

	describe("create", () => {
		it("should reject missing title", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements", {
				content: "hello",
			});
			const response = await announcement.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject empty title", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements", {
				title: "   ",
			});
			const response = await announcement.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject title exceeding max length", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements", {
				title: "a".repeat(201),
			});
			const response = await announcement.create(request, env);
			expect(response.status).toBe(400);
		});

		it("should create announcement with defaults", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						title: "New Announcement",
						content: "",
						forum_ids: "",
						sticky: 0,
						start_at: null,
						end_at: null,
						status: 1,
						author_id: 0,
						author_name: "",
						created_at: 1711540800,
						updated_at: 1711540800,
					},
				},
				runResults: {
					"INSERT INTO announcements": { success: true, meta: { last_row_id: 1, changes: 1 } },
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements", {
				title: "New Announcement",
			});
			const response = await announcement.create(request, env);
			expect(response.status).toBe(201);
			const body = (await response.json()) as { data: { title: string } };
			expect(body.data.title).toBe("New Announcement");
		});

		it("should create announcement with all fields", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 2,
						title: "Full",
						content: "Full content",
						forum_ids: "1,2",
						sticky: 1,
						start_at: 1711540800,
						end_at: 1711627200,
						status: 1,
						author_id: 5,
						author_name: "mod",
						created_at: 1711540800,
						updated_at: 1711540800,
					},
				},
				runResults: {
					"INSERT INTO announcements": { success: true, meta: { last_row_id: 2, changes: 1 } },
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements", {
				title: "Full",
				content: "Full content",
				forumIds: "1,2",
				sticky: 1,
				startAt: 1711540800,
				endAt: 1711627200,
				status: 1,
				authorId: 5,
				authorName: "mod",
			});
			const response = await announcement.create(request, env);
			expect(response.status).toBe(201);
		});
	});

	// ─── update ─────────────────────────────────────────────────────

	describe("update", () => {
		it("should return 404 for non-existent announcement", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/99", {
				title: "Updated",
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(404);
		});

		it("should update announcement title", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						title: "Updated Title",
						content: "content",
						forum_ids: "",
						sticky: 0,
						start_at: null,
						end_at: null,
						status: 1,
						author_id: 1,
						author_name: "admin",
						created_at: 1711540800,
						updated_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				title: "Updated Title",
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { title: string } };
			expect(body.data.title).toBe("Updated Title");
		});

		it("should reject content exceeding max length", async () => {
			const { db } = createMockDb({
				firstResults: { SELECT: { id: 1 } },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				content: "a".repeat(10001),
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject non-string forumIds", async () => {
			const { db } = createMockDb({
				firstResults: { SELECT: { id: 1 } },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				forumIds: 123,
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject non-number sticky", async () => {
			const { db } = createMockDb({
				firstResults: { SELECT: { id: 1 } },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				sticky: "yes",
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject non-number startAt", async () => {
			const { db } = createMockDb({
				firstResults: { SELECT: { id: 1 } },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				startAt: "tomorrow",
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject non-number endAt", async () => {
			const { db } = createMockDb({
				firstResults: { SELECT: { id: 1 } },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				endAt: "next week",
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should accept null startAt and endAt alongside other fields", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						title: "Test",
						content: "",
						forum_ids: "",
						sticky: 0,
						start_at: null,
						end_at: null,
						status: 1,
						author_id: 1,
						author_name: "admin",
						created_at: 1711540800,
						updated_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				title: "Updated",
				startAt: null,
				endAt: null,
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(200);
		});

		it("should reject non-number status", async () => {
			const { db } = createMockDb({
				firstResults: { SELECT: { id: 1 } },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/announcements/1", {
				status: "active",
			});
			const response = await announcement.update(request, env);
			expect(response.status).toBe(400);
		});
	});

	// ─── remove ─────────────────────────────────────────────────────

	describe("remove", () => {
		it("should return 404 for non-existent announcement", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("DELETE", "/api/admin/announcements/99");
			const response = await announcement.remove(request, env);
			expect(response.status).toBe(404);
		});

		it("should delete announcement", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: { id: 1 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("DELETE", "/api/admin/announcements/1");
			const response = await announcement.remove(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── batchDelete ────────────────────────────────────────────────

	describe("batchDelete", () => {
		it("should reject missing ids", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements/batch-delete", {});
			const response = await announcement.batchDelete(request, env);
			expect(response.status).toBe(400);
		});

		it("should batch delete announcements", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/announcements/batch-delete", {
				ids: [1, 2, 3],
			});
			const response = await announcement.batchDelete(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── F3-c: audit instrumentation ─────────────────────────────────

	describe("F3-c audit instrumentation", () => {
		function actorReq(method: string, path: string, body?: unknown): Request {
			return new Request(`https://api.example.com${path}`, {
				method,
				headers: {
					"X-API-Key": "test-api-key",
					"Content-Type": "application/json",
					"X-Admin-Actor-Email": "alice@example.com",
					"X-Admin-Actor-Name": "Alice",
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		}

		function findAuditInsert(calls: { sql: string; params: unknown[] }[]) {
			return calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		}

		function makeAnnRow(overrides?: Record<string, unknown>) {
			return {
				id: 1,
				title: "Welcome",
				content: "Hello everyone",
				forum_ids: "",
				sticky: 0,
				start_at: null,
				end_at: null,
				status: 1,
				author_id: 0,
				author_name: "",
				created_at: 1711540800,
				updated_at: 1711540800,
				...overrides,
			};
		}

		it("POST writes announcement.create with title/body length-only — never raw text", async () => {
			const row = makeAnnRow({ id: 99 });
			const { db, calls } = createMockDb({
				firstResults: { SELECT: row },
				runResults: { "INSERT INTO announcements": { meta: { last_row_id: 99 } } },
			});
			const env = makeEnv({ DB: db });
			const titleText = "Important announcement!";
			const bodyText = "This is the announcement body — please read carefully.";
			const res = await announcement.create(
				actorReq("POST", "/api/admin/announcements", {
					title: titleText,
					content: bodyText,
					sticky: 1,
					status: 1,
				}),
				env,
			);
			expect(res.status).toBe(201);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("announcement.create");
			expect(insert?.params[3]).toBe("announcement");
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.titleLength).toBe(titleText.length);
			expect(details.bodyLength).toBe(bodyText.length);
			// Raw title/content MUST NOT leak.
			const serialized = JSON.stringify(details);
			expect(serialized).not.toContain(titleText);
			expect(serialized).not.toContain(bodyText);
		});

		it("PATCH writes announcement.update with title/body length-only diff", async () => {
			const existing = makeAnnRow({ id: 5, title: "Old", content: "old body" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM announcements WHERE id": existing,
					SELECT: existing,
				},
			});
			const env = makeEnv({ DB: db });
			const newTitle = "Brand new title";
			const newBody = "Brand new body content here";
			const res = await announcement.update(
				actorReq("PATCH", "/api/admin/announcements/5", {
					title: newTitle,
					content: newBody,
					sticky: 1,
				}),
				env,
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("announcement.update");
			expect(insert?.params[4]).toBe(5);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.changedFields).toEqual(expect.arrayContaining(["title", "content", "sticky"]));
			expect(details.titleLengthBefore).toBe("Old".length);
			expect(details.titleLengthAfter).toBe(newTitle.length);
			expect(details.bodyLengthBefore).toBe("old body".length);
			expect(details.bodyLengthAfter).toBe(newBody.length);
			expect(details.before.sticky).toBe(0);
			expect(details.after.sticky).toBe(1);
			// Title/content text never leaks.
			const serialized = JSON.stringify(details);
			expect(serialized).not.toContain(newTitle);
			expect(serialized).not.toContain(newBody);
			expect(serialized).not.toContain("old body");
		});

		it("PATCH no-op (same values) does NOT write audit row", async () => {
			const existing = makeAnnRow({ id: 5, title: "Same", sticky: 1 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM announcements WHERE id": existing,
					SELECT: existing,
				},
			});
			const env = makeEnv({ DB: db });
			const res = await announcement.update(
				actorReq("PATCH", "/api/admin/announcements/5", { title: "Same", sticky: 1 }),
				env,
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});

		it("DELETE writes announcement.delete with length-only details", async () => {
			const titleText = "Removed Title";
			const bodyText = "Removed body content";
			const existing = makeAnnRow({ id: 7, title: titleText, content: bodyText });
			const { db, calls } = createMockDb({
				firstResults: { "SELECT * FROM announcements WHERE id": existing },
			});
			const env = makeEnv({ DB: db });
			const res = await announcement.remove(actorReq("DELETE", "/api/admin/announcements/7"), env);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("announcement.delete");
			expect(insert?.params[4]).toBe(7);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.titleLength).toBe(titleText.length);
			expect(details.bodyLength).toBe(bodyText.length);
			const serialized = JSON.stringify(details);
			expect(serialized).not.toContain(titleText);
			expect(serialized).not.toContain(bodyText);
		});

		it("batch-delete writes announcement.batch_delete only when existing > 0", async () => {
			const { db, calls } = createMockDb({
				allResults: {
					"SELECT id FROM announcements WHERE id IN": [{ id: 1 }, { id: 2 }],
				},
				firstResults: { "SELECT * FROM announcements WHERE id": makeAnnRow() },
			});
			const env = makeEnv({ DB: db });
			const res = await announcement.batchDelete(
				actorReq("POST", "/api/admin/announcements/batch-delete", { ids: [1, 2] }),
				env,
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("announcement.batch_delete");
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.ids).toEqual([1, 2]);
			expect(details.count).toBe(2);
		});

		it("batch-delete with no existing rows does NOT write audit row", async () => {
			const { db, calls } = createMockDb({
				allResults: { "SELECT id FROM announcements WHERE id IN": [] },
				firstResults: { "SELECT * FROM announcements WHERE id": makeAnnRow() },
			});
			const env = makeEnv({ DB: db });
			const res = await announcement.batchDelete(
				actorReq("POST", "/api/admin/announcements/batch-delete", { ids: [999] }),
				env,
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});
	});
});

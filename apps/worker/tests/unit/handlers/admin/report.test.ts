import { describe, expect, it } from "vitest";
import * as report from "../../../../src/handlers/admin/report";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

describe("admin report handlers", () => {
	// ─── list ───────────────────────────────────────────────────────

	describe("list", () => {
		it("should return paginated reports", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 1 } },
				allResults: {
					SELECT: [
						{
							id: 1,
							type: "post",
							target_id: 5,
							reporter_id: 10,
							reporter_name: "alice",
							reason: "spam",
							status: "pending",
							handler_id: null,
							handler_name: "",
							handled_at: null,
							created_at: 1711540800,
							thread_id: 2,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports");
			const response = await report.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: { id: number; threadId: number | null }[];
				meta: { total: number };
			};
			expect(body.data).toHaveLength(1);
			expect(body.data[0].threadId).toBe(2);
			expect(body.meta.total).toBe(1);
		});

		it("should expose per-type target metadata for thread reports", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 1 } },
				allResults: {
					SELECT: [
						{
							id: 2,
							type: "thread",
							target_id: 7,
							reporter_id: 10,
							reporter_name: "alice",
							reason: "spam",
							status: "pending",
							handler_id: null,
							handler_name: "",
							handled_at: null,
							created_at: 1711540800,
							thread_id: 7,
							target_title: "Hello world",
							target_name: null,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?type=thread");
			const response = await report.list(request, env);
			const body = (await response.json()) as {
				data: {
					type: string;
					threadId: number | null;
					targetTitle: string | null;
					targetName: string | null;
				}[];
			};
			expect(body.data[0].type).toBe("thread");
			expect(body.data[0].threadId).toBe(7);
			expect(body.data[0].targetTitle).toBe("Hello world");
			expect(body.data[0].targetName).toBeNull();
		});

		it("should expose per-type target metadata for user reports", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 1 } },
				allResults: {
					SELECT: [
						{
							id: 3,
							type: "user",
							target_id: 12,
							reporter_id: 10,
							reporter_name: "alice",
							reason: "spam",
							status: "pending",
							handler_id: null,
							handler_name: "",
							handled_at: null,
							created_at: 1711540800,
							thread_id: null,
							target_title: null,
							target_name: "bob",
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?type=user");
			const response = await report.list(request, env);
			const body = (await response.json()) as {
				data: {
					type: string;
					threadId: number | null;
					targetTitle: string | null;
					targetName: string | null;
				}[];
			};
			expect(body.data[0].type).toBe("user");
			expect(body.data[0].threadId).toBeNull();
			expect(body.data[0].targetTitle).toBeNull();
			expect(body.data[0].targetName).toBe("bob");
		});

		it("should ignore invalid type filter", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?type=forum");
			const response = await report.list(request, env);
			expect(response.status).toBe(200);
			// 'forum' must NOT appear in any bind params
			const allParams = calls.flatMap((c) => c.params);
			expect(allParams).not.toContain("forum");
		});

		it("JOIN SQL uses threads.subject (not .title) — schema regression guard", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports");
			await report.list(request, env);
			const joinSql = calls.find(
				(c) => c.sql.includes("LEFT JOIN") && c.sql.includes("AS target_title"),
			)?.sql;
			expect(joinSql).toBeDefined();
			expect(joinSql).toContain("t.subject");
			expect(joinSql).toContain("tp.subject");
			// `threads` has no `title` column — this guards against silent regression.
			expect(joinSql).not.toMatch(/\bt\.title\b/);
			expect(joinSql).not.toMatch(/\btp\.title\b/);
		});

		it("should filter by status", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?status=pending");
			const response = await report.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by type", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?type=post");
			const response = await report.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by reporterId", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?reporterId=10");
			const response = await report.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should ignore invalid status filter", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?status=invalid");
			const response = await report.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports?page=-1");
			const response = await report.list(request, env);
			expect(response.status).toBe(400);
		});
	});

	// ─── getById ────────────────────────────────────────────────────

	describe("getById", () => {
		it("should reject invalid report ID", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports/abc");
			const response = await report.getById(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 for non-existent report", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports/99");
			const response = await report.getById(request, env);
			expect(response.status).toBe(404);
		});

		it("should return report with thread_id from JOIN", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						type: "post",
						target_id: 5,
						reporter_id: 10,
						reporter_name: "alice",
						reason: "spam",
						status: "pending",
						handler_id: null,
						handler_name: "",
						handled_at: null,
						created_at: 1711540800,
						thread_id: 3,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/reports/1");
			const response = await report.getById(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { id: number; threadId: number } };
			expect(body.data.id).toBe(1);
			expect(body.data.threadId).toBe(3);
		});
	});

	// ─── update ─────────────────────────────────────────────────────

	describe("update", () => {
		it("should reject invalid report ID", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/reports/abc", {
				status: "resolved",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject invalid JSON body", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/admin/reports/1", {
				method: "PATCH",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: "not json",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject invalid status value", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/reports/1", {
				status: "invalid",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 for non-existent report", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/reports/99", {
				status: "resolved",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(404);
		});

		it("should resolve a report", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						type: "post",
						target_id: 5,
						reporter_id: 10,
						reporter_name: "alice",
						reason: "spam",
						status: "resolved",
						handler_id: 1,
						handler_name: "admin",
						handled_at: 1711544400,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/reports/1", {
				status: "resolved",
				handlerId: 1,
				handlerName: "admin",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { status: string } };
			expect(body.data.status).toBe("resolved");
		});

		it("should dismiss a report", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						type: "post",
						target_id: 5,
						reporter_id: 10,
						reporter_name: "alice",
						reason: "spam",
						status: "dismissed",
						handler_id: 2,
						handler_name: "mod",
						handled_at: 1711544400,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/reports/1", {
				status: "dismissed",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(200);
		});

		it("should revert to pending and clear handler info", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						type: "post",
						target_id: 5,
						reporter_id: 10,
						reporter_name: "alice",
						reason: "spam",
						status: "pending",
						handler_id: null,
						handler_name: "",
						handled_at: null,
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/reports/1", {
				status: "pending",
			});
			const response = await report.update(request, env);
			expect(response.status).toBe(200);
		});
	});

	// ─── batchDelete ────────────────────────────────────────────────

	describe("batchDelete", () => {
		it("should reject missing ids", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/reports/batch-delete", {});
			const response = await report.batchDelete(request, env);
			expect(response.status).toBe(400);
		});

		it("should batch delete reports", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/reports/batch-delete", {
				ids: [1, 2],
			});
			const response = await report.batchDelete(request, env);
			expect(response.status).toBe(200);
		});
	});
});

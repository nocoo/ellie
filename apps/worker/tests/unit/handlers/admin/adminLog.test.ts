import { describe, expect, it } from "vitest";
import * as adminLog from "../../../../src/handlers/admin/adminLog";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

describe("admin adminLog handlers", () => {
	// ─── list ───────────────────────────────────────────────────────

	describe("list", () => {
		it("should return paginated admin logs", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*)": { total: 2 },
				},
				allResults: {
					SELECT: [
						{
							id: 1,
							admin_id: 1,
							admin_name: "admin",
							action: "ban_user",
							target_type: "user",
							target_id: 5,
							details: "{}",
							ip: "1.2.3.4",
							created_at: 1711540800,
						},
						{
							id: 2,
							admin_id: 1,
							admin_name: "admin",
							action: "delete_thread",
							target_type: "thread",
							target_id: 10,
							details: "{}",
							ip: "1.2.3.4",
							created_at: 1711544400,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs");
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: unknown[]; meta: { total: number } };
			expect(body.data).toHaveLength(2);
			expect(body.meta.total).toBe(2);
		});

		it("should filter by adminId", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT COUNT(*)": { total: 1 },
				},
				allResults: {
					SELECT: [
						{
							id: 1,
							admin_id: 2,
							admin_name: "mod",
							action: "edit_post",
							target_type: "post",
							target_id: 3,
							details: "{}",
							ip: "1.2.3.4",
							created_at: 1711540800,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs?adminId=2");
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by action", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs?action=ban_user");
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by targetType and targetId", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs?targetType=user&targetId=5");
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should filter by date range", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 0 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest(
				"GET",
				"/api/admin/admin-logs?startDate=1711540800&endDate=1711627200",
			);
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(200);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs?page=0");
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(400);
		});

		it("should support pagination params", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT(*)": { total: 50 } },
				allResults: { SELECT: [] },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs?page=2&limit=10");
			const response = await adminLog.list(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { meta: { page: number; limit: number } };
			expect(body.meta.page).toBe(2);
			expect(body.meta.limit).toBe(10);
		});
	});

	// ─── getById ────────────────────────────────────────────────────

	describe("getById", () => {
		it("should return 404 for non-existent log", async () => {
			const { db } = createMockDb({
				firstResults: {},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs/99");
			const response = await adminLog.getById(request, env);
			expect(response.status).toBe(404);
		});

		it("should return admin log by id", async () => {
			const { db } = createMockDb({
				firstResults: {
					SELECT: {
						id: 1,
						admin_id: 1,
						admin_name: "admin",
						action: "ban_user",
						target_type: "user",
						target_id: 5,
						details: "{}",
						ip: "1.2.3.4",
						created_at: 1711540800,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/admin-logs/1");
			const response = await adminLog.getById(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { id: number; action: string } };
			expect(body.data.id).toBe(1);
			expect(body.data.action).toBe("ban_user");
		});
	});
});

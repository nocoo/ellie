import { describe, expect, it } from "vitest";
import * as statistics from "../../../../src/handlers/admin/statistics";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

describe("admin statistics handlers", () => {
	// ─── recalcForums ───────────────────────────────────────────────

	describe("recalcForums", () => {
		it("should return updated=0 when no forums exist", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM forums": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-forums");
			const response = await statistics.recalcForums(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(0);
		});

		it("should recalculate forum counters", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM forums": [{ id: 1 }, { id: 2 }],
					"SELECT forum_id, COUNT(*) as cnt FROM threads": [
						{ forum_id: 1, cnt: 10 },
						{ forum_id: 2, cnt: 5 },
					],
					"SELECT forum_id, COUNT(*) as cnt FROM posts": [
						{ forum_id: 1, cnt: 100 },
						{ forum_id: 2, cnt: 50 },
					],
					"SELECT t1.forum_id": [
						{
							forum_id: 1,
							id: 42,
							subject: "Latest",
							last_post_at: 1711544400,
							last_poster: "bob",
							last_poster_id: 20,
						},
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-forums");
			const response = await statistics.recalcForums(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(2);
		});
	});

	// ─── recalcThreads ──────────────────────────────────────────────

	describe("recalcThreads", () => {
		it("should reject invalid JSON body", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/admin/statistics/recalc-threads", {
				method: "POST",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: "invalid json",
			});
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(400);
		});

		it("should return updated=0 when no threads exist", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, created_at, author_name, author_id FROM threads": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-threads");
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(0);
		});

		it("should recalculate thread counters for all threads", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, created_at, author_name, author_id FROM threads": [
						{ id: 1, created_at: 1711540800, author_name: "alice", author_id: 10 },
						{ id: 2, created_at: 1711544400, author_name: "bob", author_id: 20 },
					],
					"SELECT thread_id, COUNT(*) - 1 as cnt FROM posts": [
						{ thread_id: 1, cnt: 5 },
						{ thread_id: 2, cnt: 2 },
					],
					"SELECT p1.thread_id, p1.created_at, p1.author_name, p1.author_id": [
						{ thread_id: 1, created_at: 1711544400, author_name: "bob", author_id: 20 },
						{ thread_id: 2, created_at: 1711548000, author_name: "carol", author_id: 30 },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-threads");
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(2);
		});

		it("should filter by forumId when provided", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, created_at, author_name, author_id FROM threads WHERE forum_id": [
						{ id: 1, created_at: 1711540800, author_name: "alice", author_id: 10 },
					],
					"SELECT thread_id, COUNT(*) - 1 as cnt FROM posts": [{ thread_id: 1, cnt: 3 }],
					"SELECT p1.thread_id, p1.created_at, p1.author_name, p1.author_id": [
						{ thread_id: 1, created_at: 1711544400, author_name: "bob", author_id: 20 },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-threads", {
				forumId: 1,
			});
			const response = await statistics.recalcThreads(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(1);
		});
	});

	// ─── recalcUsers ────────────────────────────────────────────────

	describe("recalcUsers", () => {
		it("should return updated=0 when no users found", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(0);
		});

		it("should recalculate user counters for all users", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users": [{ id: 1 }, { id: 2 }, { id: 3 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads GROUP": [
						{ author_id: 1, cnt: 10 },
						{ author_id: 2, cnt: 5 },
					],
					"SELECT author_id, COUNT(*) as cnt FROM posts GROUP": [
						{ author_id: 1, cnt: 50 },
						{ author_id: 2, cnt: 30 },
						{ author_id: 3, cnt: 10 },
					],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest": [{ author_id: 1, cnt: 2 }],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(3);
		});

		it("should recalculate specific user ids when provided", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT author_id, COUNT(*) as cnt FROM threads GROUP": [{ author_id: 5, cnt: 3 }],
					"SELECT author_id, COUNT(*) as cnt FROM posts GROUP": [{ author_id: 5, cnt: 20 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users", {
				ids: [5],
			});
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { updated: number } };
			expect(body.data.updated).toBe(1);
		});

		it("should handle empty body gracefully", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users": [{ id: 1 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads GROUP": [],
					"SELECT author_id, COUNT(*) as cnt FROM posts GROUP": [],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest": [],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
			const response = await statistics.recalcUsers(request, env);
			expect(response.status).toBe(200);
		});
	});
});

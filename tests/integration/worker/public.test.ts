// tests/integration/worker/public.test.ts — L2 Worker Public API Tests
// Tests all public endpoints that require only Key A (no JWT)

import { describe, expect, test } from "bun:test";
import { workerFetch } from "../setup";

describe("L2: Worker Public API", () => {
	// ─── Forums ────────────────────────────────────────────────────

	describe("GET /api/v1/forums", () => {
		test("returns 200 with forum list", async () => {
			const res = await workerFetch("/api/v1/forums");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("each forum has required fields", async () => {
			const res = await workerFetch("/api/v1/forums");
			const data = await res.json();
			if (data.data.length > 0) {
				const forum = data.data[0];
				expect(forum).toHaveProperty("id");
				expect(forum).toHaveProperty("name");
			}
		});
	});

	describe("GET /api/v1/forums/:id", () => {
		test("returns specific forum", async () => {
			// First get list to find a valid ID
			const listRes = await workerFetch("/api/v1/forums");
			const listData = await listRes.json();
			if (listData.data.length > 0) {
				const forumId = listData.data[0].id;
				const res = await workerFetch(`/api/v1/forums/${forumId}`);
				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.data.id).toBe(forumId);
			}
		});

		test("returns 404 for non-existent forum", async () => {
			const res = await workerFetch("/api/v1/forums/999999");
			expect(res.status).toBe(404);
		});
	});

	// ─── Threads ───────────────────────────────────────────────────

	describe("GET /api/v1/threads", () => {
		test("returns 200 with thread list", async () => {
			const res = await workerFetch("/api/v1/threads");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("supports forumId filter", async () => {
			const res = await workerFetch("/api/v1/threads?forumId=1");
			expect(res.status).toBe(200);
		});

		test("supports pagination", async () => {
			const res = await workerFetch("/api/v1/threads?limit=5&offset=0");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data.length).toBeLessThanOrEqual(5);
		});
	});

	describe("GET /api/v1/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await workerFetch("/api/v1/threads/999999");
			expect(res.status).toBe(404);
		});

		test("returns specific thread when exists", async () => {
			// First get list to find a valid ID
			const listRes = await workerFetch("/api/v1/threads?limit=1");
			const listData = await listRes.json();
			if (listData.data.length > 0) {
				const threadId = listData.data[0].id;
				const res = await workerFetch(`/api/v1/threads/${threadId}`);
				expect(res.status).toBe(200);
				const data = await res.json();
				expect(data.data.id).toBe(threadId);
			}
		});
	});

	// ─── Posts ─────────────────────────────────────────────────────

	describe("GET /api/v1/posts", () => {
		test("requires threadId parameter", async () => {
			const res = await workerFetch("/api/v1/posts");
			// Should return 400 for missing threadId
			expect(res.status).toBe(400);
		});

		test("returns posts for valid threadId", async () => {
			// Get a thread first
			const threadRes = await workerFetch("/api/v1/threads?limit=1");
			const threadData = await threadRes.json();
			if (threadData.data.length > 0) {
				const threadId = threadData.data[0].id;
				const res = await workerFetch(`/api/v1/posts?threadId=${threadId}`);
				expect(res.status).toBe(200);
				const data = await res.json();
				expect(Array.isArray(data.data)).toBe(true);
			}
		});
	});

	describe("GET /api/v1/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await workerFetch("/api/v1/posts/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/posts/:id/attachments", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await workerFetch("/api/v1/posts/999999/attachments");
			expect(res.status).toBe(404);
		});
	});

	// ─── Users ─────────────────────────────────────────────────────

	describe("GET /api/v1/users/:id", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await workerFetch("/api/v1/users/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/users/:id/threads", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await workerFetch("/api/v1/users/999999/threads");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/users/:id/posts", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await workerFetch("/api/v1/users/999999/posts");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/users/:id/digest", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await workerFetch("/api/v1/users/999999/digest");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/users/search", () => {
		test("returns 200 with search results", async () => {
			const res = await workerFetch("/api/v1/users/search?q=test");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("requires q parameter", async () => {
			const res = await workerFetch("/api/v1/users/search");
			expect(res.status).toBe(400);
		});
	});

	// ─── Digest ────────────────────────────────────────────────────

	describe("GET /api/v1/digest", () => {
		test("returns 200 with digest list", async () => {
			const res = await workerFetch("/api/v1/digest");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("GET /api/v1/digest/stats", () => {
		test("returns 200 with stats", async () => {
			const res = await workerFetch("/api/v1/digest/stats");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	// ─── Stats & Settings ──────────────────────────────────────────

	describe("GET /api/v1/stats", () => {
		test("returns 200 with stats", async () => {
			const res = await workerFetch("/api/v1/stats");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/v1/settings", () => {
		test("returns 200 with settings", async () => {
			const res = await workerFetch("/api/v1/settings");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	// ─── Health Check ──────────────────────────────────────────────

	describe("GET /api/live", () => {
		test("returns 200", async () => {
			// Health check doesn't need API key
			const res = await fetch("http://localhost:8787/api/live");
			expect(res.status).toBe(200);
		});
	});
});

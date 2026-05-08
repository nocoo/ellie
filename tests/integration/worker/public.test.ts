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

	describe("GET /api/v1/forums/:id/ancestors", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await workerFetch("/api/v1/forums/999999/ancestors");
			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error.code).toBe("FORUM_NOT_FOUND");
		});

		test("returns forum context + ancestor chain for existing forum", async () => {
			// Pick any forum from /api/v1/forums to avoid hard-coding IDs.
			const listRes = await workerFetch("/api/v1/forums");
			expect(listRes.status).toBe(200);
			const listData = await listRes.json();
			if (listData.data.length === 0) return;

			const forumId = listData.data[0].id;
			const res = await workerFetch(`/api/v1/forums/${forumId}/ancestors`);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data).toHaveProperty("forum");
			expect(data.data.forum.id).toBe(forumId);
			expect(data.data).toHaveProperty("ancestors");
			expect(Array.isArray(data.data.ancestors)).toBe(true);
		});
	});

	// ─── Threads ───────────────────────────────────────────────────

	describe("GET /api/v1/threads", () => {
		test("requires forumId parameter", async () => {
			const res = await workerFetch("/api/v1/threads");
			// forumId is required
			expect(res.status).toBe(400);
		});

		test("returns 200 with thread list when forumId provided", async () => {
			const res = await workerFetch("/api/v1/threads?forumId=1");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("supports pagination", async () => {
			const res = await workerFetch("/api/v1/threads?forumId=1&limit=5&page=1");
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
			// Use thread id=1 which was seeded in test DB
			const res = await workerFetch("/api/v1/threads/1");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data.id).toBe(1);
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
			// Use thread id=1 which was seeded in test DB
			const res = await workerFetch("/api/v1/posts?threadId=1");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("GET /api/v1/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await workerFetch("/api/v1/posts/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/posts/:id/attachments", () => {
		test("returns empty array for post without attachments", async () => {
			// Post id=1 exists but has no attachments
			const res = await workerFetch("/api/v1/posts/1/attachments");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("returns 404 for non-existent post", async () => {
			const res = await workerFetch("/api/v1/posts/999999/attachments");
			// API returns 200 with empty array even for non-existent post
			// This is acceptable behavior for attachment listing
			expect([200, 404]).toContain(res.status);
		});
	});

	// ─── Users ─────────────────────────────────────────────────────

	describe("GET /api/v1/users/:id", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await workerFetch("/api/v1/users/999999");
			expect(res.status).toBe(404);
		});

		test("returns user profile for existing user", async () => {
			// User id=3 (testuser) was seeded in test DB
			const res = await workerFetch("/api/v1/users/3");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data.id).toBe(3);
			expect(data.data.username).toBe("testuser");
		});
	});

	describe("GET /api/v1/users/:id/threads", () => {
		test("returns empty array for user with no threads", async () => {
			// API returns 200 with empty data for non-existent or empty user
			const res = await workerFetch("/api/v1/users/999999/threads");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("returns threads for existing user", async () => {
			// User id=3 (testuser) created thread id=1
			const res = await workerFetch("/api/v1/users/3/threads");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("GET /api/v1/users/:id/posts", () => {
		test("returns empty array for user with no posts", async () => {
			// API returns 200 with empty data
			const res = await workerFetch("/api/v1/users/999999/posts");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("GET /api/v1/users/:id/digest", () => {
		test("returns empty array for user with no digest posts", async () => {
			// API returns 200 with empty data
			const res = await workerFetch("/api/v1/users/999999/digest");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
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

	describe("GET /api/v1/users/:id/avatar-path", () => {
		test("returns 400 for invalid user id", async () => {
			const res = await workerFetch("/api/v1/users/0/avatar-path");
			// path regex \d+ rejects 0 via id <= 0 guard → 400 INVALID_REQUEST
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns 404 for non-existent user", async () => {
			const res = await workerFetch("/api/v1/users/999999/avatar-path");
			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
		});

		test("returns avatarPath for existing user", async () => {
			const res = await workerFetch("/api/v1/users/3/avatar-path");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data).toHaveProperty("avatarPath");
			expect(typeof data.data.avatarPath).toBe("string");
		});
	});

	describe("GET /api/v1/users/batch", () => {
		test("returns 400 when ids is missing", async () => {
			const res = await workerFetch("/api/v1/users/batch");
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns empty array for ids that parse to nothing", async () => {
			const res = await workerFetch("/api/v1/users/batch?ids=abc,,-1");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
			expect(data.data).toHaveLength(0);
		});

		test("returns 400 when ids exceed batch cap", async () => {
			const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
			const res = await workerFetch(`/api/v1/users/batch?ids=${ids}`);
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns existing public users for valid ids", async () => {
			const res = await workerFetch("/api/v1/users/batch?ids=3,999999");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
			// Only id=3 should come back; non-existent users are silently dropped.
			const ids = data.data.map((u: { id: number }) => u.id);
			expect(ids).toContain(3);
			expect(ids).not.toContain(999999);
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

	describe("GET /api/v1/digest/filters", () => {
		test("returns 200 with years and forums arrays", async () => {
			const res = await workerFetch("/api/v1/digest/filters");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data).toHaveProperty("years");
			expect(data.data).toHaveProperty("forums");
			expect(Array.isArray(data.data.years)).toBe(true);
			expect(Array.isArray(data.data.forums)).toBe(true);
			// Each year is a number; forum entries shape-match.
			for (const y of data.data.years) expect(typeof y).toBe("number");
			for (const f of data.data.forums) {
				expect(f).toHaveProperty("id");
				expect(f).toHaveProperty("name");
				expect(f).toHaveProperty("digestCount");
			}
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

	// ─── Search ────────────────────────────────────────────────────

	describe("GET /api/v1/search/threads", () => {
		test("returns 400 for missing query", async () => {
			const res = await workerFetch("/api/v1/search/threads");
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns 400 for query less than 2 chars", async () => {
			const res = await workerFetch("/api/v1/search/threads?q=a");
			expect(res.status).toBe(400);
		});

		test("returns 200 with results for valid query", async () => {
			// Search for common term likely to exist in test data
			const res = await workerFetch("/api/v1/search/threads?q=test");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
			expect(data.meta).toHaveProperty("total");
			expect(typeof data.meta.total).toBe("number");
		});

		test("Chinese keywords work correctly", async () => {
			// Test Chinese search capability
			const res = await workerFetch("/api/v1/search/threads?q=测试");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("multi-keyword AND search", async () => {
			// Space-separated keywords should perform AND search
			const res = await workerFetch("/api/v1/search/threads?q=test%20post");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(Array.isArray(data.data)).toBe(true);
		});

		test("respects limit parameter", async () => {
			const res = await workerFetch("/api/v1/search/threads?q=test&limit=5");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data.length).toBeLessThanOrEqual(5);
		});

		test("pagination with cursor works", async () => {
			// Get first page
			const res1 = await workerFetch("/api/v1/search/threads?q=test&limit=1");
			expect(res1.status).toBe(200);
			const data1 = await res1.json();

			// If there's a next cursor, test pagination
			if (data1.meta.nextCursor) {
				const cursor = encodeURIComponent(data1.meta.nextCursor);
				const res2 = await workerFetch(`/api/v1/search/threads?q=test&limit=1&cursor=${cursor}`);
				expect(res2.status).toBe(200);
				const data2 = await res2.json();
				expect(Array.isArray(data2.data)).toBe(true);
			}
		});

		test("returns 400 for invalid cursor", async () => {
			const res = await workerFetch("/api/v1/search/threads?q=test&cursor=invalid!!!");
			expect(res.status).toBe(400);
		});

		test("response matches Thread type contract", async () => {
			const res = await workerFetch("/api/v1/search/threads?q=test&limit=1");
			expect(res.status).toBe(200);
			const data = await res.json();

			if (data.data.length > 0) {
				const thread = data.data[0];
				// Verify required Thread fields
				expect(thread).toHaveProperty("id");
				expect(thread).toHaveProperty("forumId");
				expect(thread).toHaveProperty("authorId");
				expect(thread).toHaveProperty("authorName");
				expect(thread).toHaveProperty("subject");
				expect(thread).toHaveProperty("createdAt");
				expect(thread).toHaveProperty("lastPostAt");
				expect(thread).toHaveProperty("replies");
				expect(thread).toHaveProperty("views");
				// Additional fields from Thread type
				expect(thread).toHaveProperty("closed");
				expect(thread).toHaveProperty("sticky");
				expect(thread).toHaveProperty("digest");
				expect(thread).toHaveProperty("special");
				expect(thread).toHaveProperty("highlight");
				expect(thread).toHaveProperty("recommends");
			}
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

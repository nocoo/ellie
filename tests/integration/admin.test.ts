// tests/integration/admin.test.ts — L2: Admin API integration tests
// Tests actual Admin API endpoints against running Worker
// Run with: WORKER_URL=http://localhost:8787 bun test tests/integration/admin.test.ts

import { describe, expect, test } from "bun:test";
import { apiFetch, apiPatch, apiPost } from "./setup";

/**
 * Admin GET helper — includes X-Mock-Uid for proxy auth + X-Mock-Role for
 * the admin role guard inside the API route.
 */
function adminGet(path: string, role?: number): Promise<Response> {
	const headers: Record<string, string> = { "X-Mock-Uid": "1" };
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return apiFetch(path, { headers });
}

/**
 * Admin POST helper — includes X-Mock-Uid for proxy auth + X-Mock-Role for
 * the admin role guard inside the API route.
 */
function adminPost(path: string, body: Record<string, unknown>, role?: number): Promise<Response> {
	const headers: Record<string, string> = { "X-Mock-Uid": "1" };
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return apiPost(path, body, headers);
}

/**
 * Admin PATCH helper — includes X-Mock-Uid for proxy auth + X-Mock-Role for
 * the admin role guard inside the API route.
 */
function adminPatch(path: string, body: Record<string, unknown>, role?: number): Promise<Response> {
	const headers: Record<string, string> = { "X-Mock-Uid": "1" };
	if (role !== undefined) headers["X-Mock-Role"] = String(role);
	return apiPatch(path, body, headers);
}

// ═══════════════════════════════════════════════════════════════════════════
// Role Guard Tests (403 Forbidden)
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: Admin role guard (403)", () => {
	test("GET /api/admin/users returns 403 without role", async () => {
		const response = await adminGet("/api/admin/users");
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/users returns 403 for Mod (3)", async () => {
		const response = await adminGet("/api/admin/users", 3);
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/users returns 403 for User (0)", async () => {
		const response = await adminGet("/api/admin/users", 0);
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/threads returns 403 without role", async () => {
		const response = await adminGet("/api/admin/threads");
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/forums returns 403 without role", async () => {
		const response = await adminGet("/api/admin/forums");
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/attachments returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/attachments", 3);
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/ip-bans returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/ip-bans", 0);
		expect(response.status).toBe(403);
	});

	test("GET /api/admin/censor-words returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/censor-words", 3);
		expect(response.status).toBe(403);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard & Stats
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/stats", () => {
	test("returns dashboard stats for Admin (1)", async () => {
		const response = await adminGet("/api/admin/stats", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveProperty("totalUsers");
		expect(json.data).toHaveProperty("totalThreads");
		expect(json.data).toHaveProperty("totalPosts");
	});

	test("returns dashboard stats for SuperMod (2)", async () => {
		const response = await adminGet("/api/admin/stats", 2);
		expect(response.status).toBe(200);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// User Management
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/users", () => {
	test("returns user list for Admin (1)", async () => {
		const response = await adminGet("/api/admin/users", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.meta).toHaveProperty("total");
	});

	test("returns user list for SuperMod (2)", async () => {
		const response = await adminGet("/api/admin/users", 2);
		expect(response.status).toBe(200);
	});

	test("supports pagination with page and limit params", async () => {
		const response = await adminGet("/api/admin/users?page=1&limit=10", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.meta).toHaveProperty("page");
		expect(json.meta).toHaveProperty("limit");
	});

	test("supports search by username", async () => {
		const response = await adminGet("/api/admin/users?search=admin", 1);
		expect(response.status).toBe(200);
	});
});

describe("L2: PATCH /api/admin/users/:id", () => {
	test("updates user for Admin (1)", async () => {
		// Get a valid user ID first
		const listResponse = await adminGet("/api/admin/users", 1);
		const { data: users } = await listResponse.json();
		if (users.length === 0) return;

		const userId = users[0].id;
		const response = await adminPatch(`/api/admin/users/${userId}`, { signature: "L2 test" }, 1);
		expect(response.status).toBe(200);
	});
});

describe("L2: POST /api/admin/users/:id/ban", () => {
	test("bans user for Admin (1)", async () => {
		// Get a non-admin user to ban
		const listResponse = await adminGet("/api/admin/users?role=0", 1);
		const { data: users } = await listResponse.json();
		const normalUser = users.find((u: { role: number }) => u.role === 0);
		if (!normalUser) return;

		const response = await adminPost(`/api/admin/users/${normalUser.id}/ban`, {}, 1);
		// May succeed or fail depending on current state, just check it's not 403/500
		expect([200, 400]).toContain(response.status);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Thread Management
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/threads", () => {
	test("returns thread list for admin", async () => {
		const response = await adminGet("/api/admin/threads", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});

	test("supports pagination", async () => {
		const response = await adminGet("/api/admin/threads?page=1&limit=5", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.meta).toHaveProperty("page");
	});

	test("supports filter by forumId", async () => {
		const response = await adminGet("/api/admin/threads?forumId=1", 1);
		expect(response.status).toBe(200);
	});
});

describe("L2: GET /api/admin/threads/:id", () => {
	test("returns thread detail with posts", async () => {
		// Get a thread ID first
		const listResponse = await adminGet("/api/admin/threads?limit=1", 1);
		const { data: threads } = await listResponse.json();
		if (threads.length === 0) return;

		const threadId = threads[0].id;
		const response = await adminGet(`/api/admin/threads/${threadId}`, 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveProperty("id");
		expect(json.data).toHaveProperty("title");
	});
});

describe("L2: PATCH /api/admin/threads/:id", () => {
	test("updates thread for admin", async () => {
		const listResponse = await adminGet("/api/admin/threads?limit=1", 1);
		const { data: threads } = await listResponse.json();
		if (threads.length === 0) return;

		const threadId = threads[0].id;
		const response = await adminPatch(`/api/admin/threads/${threadId}`, { closed: false }, 1);
		expect(response.status).toBe(200);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Forum Management
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/forums", () => {
	test("returns forum list for admin", async () => {
		const response = await adminGet("/api/admin/forums", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});
});

describe("L2: PATCH /api/admin/forums/:id", () => {
	test("updates forum for admin", async () => {
		const listResponse = await adminGet("/api/admin/forums", 1);
		const { data: forums } = await listResponse.json();
		if (forums.length === 0) return;

		const forumId = forums[0].id;
		const response = await adminPatch(`/api/admin/forums/${forumId}`, { description: "L2 test" }, 1);
		expect(response.status).toBe(200);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Attachment Management
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/attachments", () => {
	test("returns attachment list for admin", async () => {
		const response = await adminGet("/api/admin/attachments", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});

	test("supports filter by type", async () => {
		const response = await adminGet("/api/admin/attachments?type=image", 1);
		expect(response.status).toBe(200);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// IP Ban Management
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/ip-bans", () => {
	test("returns IP ban list for admin", async () => {
		const response = await adminGet("/api/admin/ip-bans", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});
});

describe("L2: GET /api/admin/ip-bans/check-ip", () => {
	test("checks IP status", async () => {
		const response = await adminGet("/api/admin/ip-bans/check-ip?ip=192.168.1.1", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveProperty("banned");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Censor Words Management
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/censor-words", () => {
	test("returns censor word list for admin", async () => {
		const response = await adminGet("/api/admin/censor-words", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
	});
});

describe("L2: POST /api/admin/censor-words/test", () => {
	test("tests content against censor rules", async () => {
		const response = await adminPost("/api/admin/censor-words/test", { content: "hello world" }, 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveProperty("result");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/settings", () => {
	test("returns settings for admin", async () => {
		const response = await adminGet("/api/admin/settings", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Reports Management (§6)
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/reports", () => {
	test("returns report list for admin", async () => {
		const response = await adminGet("/api/admin/reports", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.meta).toHaveProperty("total");
	});

	test("returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/reports", 3);
		expect(response.status).toBe(403);
	});

	test("supports status filter", async () => {
		const response = await adminGet("/api/admin/reports?status=pending", 1);
		expect(response.status).toBe(200);
	});

	test("supports type filter", async () => {
		const response = await adminGet("/api/admin/reports?type=thread", 1);
		expect(response.status).toBe(200);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin Logs (§7)
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/admin-logs", () => {
	test("returns admin log list for admin", async () => {
		const response = await adminGet("/api/admin/admin-logs", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.meta).toHaveProperty("total");
	});

	test("returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/admin-logs", 3);
		expect(response.status).toBe(403);
	});

	test("supports action filter", async () => {
		const response = await adminGet("/api/admin/admin-logs?action=ban", 1);
		expect(response.status).toBe(200);
	});

	test("supports adminId filter", async () => {
		const response = await adminGet("/api/admin/admin-logs?adminId=1", 1);
		expect(response.status).toBe(200);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Announcements (§9)
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/announcements", () => {
	test("returns announcement list for admin", async () => {
		const response = await adminGet("/api/admin/announcements", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.meta).toHaveProperty("total");
	});

	test("returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/announcements", 3);
		expect(response.status).toBe(403);
	});

	test("supports status filter", async () => {
		const response = await adminGet("/api/admin/announcements?status=1", 1);
		expect(response.status).toBe(200);
	});

	test("supports active filter", async () => {
		const response = await adminGet("/api/admin/announcements?active=true", 1);
		expect(response.status).toBe(200);
	});
});

describe("L2: POST /api/admin/announcements", () => {
	test("creates announcement for admin", async () => {
		const response = await adminPost(
			"/api/admin/announcements",
			{
				title: "L2 Test Announcement",
				content: "This is a test announcement from L2 tests",
			},
			1,
		);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveProperty("id");
		expect(json.data.title).toBe("L2 Test Announcement");
	});

	test("returns 400 for missing title", async () => {
		const response = await adminPost(
			"/api/admin/announcements",
			{ content: "No title provided" },
			1,
		);
		expect(response.status).toBe(400);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff Management (§8)
// ═══════════════════════════════════════════════════════════════════════════

describe("L2: GET /api/admin/users/staff", () => {
	test("returns staff user list for admin", async () => {
		const response = await adminGet("/api/admin/users/staff", 1);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(Array.isArray(json.data)).toBe(true);
		// All returned users should have role > 0
		for (const user of json.data) {
			expect(user.role).toBeGreaterThan(0);
		}
	});

	test("returns 403 for non-admin", async () => {
		const response = await adminGet("/api/admin/users/staff", 3);
		expect(response.status).toBe(403);
	});
});

describe("L2: POST /api/admin/users/batch-role", () => {
	test("updates roles for admin", async () => {
		// Get a non-admin user first
		const listResponse = await adminGet("/api/admin/users?role=0&limit=1", 1);
		const { data: users } = await listResponse.json();
		if (users.length === 0) return;

		const response = await adminPost(
			"/api/admin/users/batch-role",
			{ ids: [users[0].id], role: 0 },
			1,
		);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.data).toHaveProperty("updated");
	});

	test("returns 400 for invalid role", async () => {
		const response = await adminPost(
			"/api/admin/users/batch-role",
			{ ids: [1], role: 5 },
			1,
		);
		expect(response.status).toBe(400);
	});
});

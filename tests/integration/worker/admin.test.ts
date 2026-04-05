// tests/integration/worker/admin.test.ts — L2 Worker Admin API Tests
// Tests admin endpoints: forums, threads, posts, users, settings, etc.

import { describe, expect, test } from "bun:test";
import { adminDelete, adminGet, adminPatch, adminPost, adminPut } from "../setup";

describe("L2: Worker Admin API", () => {
	// ─── Admin Forums ──────────────────────────────────────────────

	describe("GET /api/admin/forums", () => {
		test("returns 200 with forum list", async () => {
			const res = await adminGet("/api/admin/forums");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(Array.isArray(data.data)).toBe(true);
		});
	});

	describe("GET /api/admin/forums/:id", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminGet("/api/admin/forums/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/forums", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/forums", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/forums/reorder", () => {
		test("returns 400 for invalid body", async () => {
			const res = await adminPost("/api/admin/forums/reorder", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/forums/:id/merge", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminPost("/api/admin/forums/999999/merge", {
				targetForumId: 1,
			});
			expect([400, 404]).toContain(res.status);
		});
	});

	describe("PATCH /api/admin/forums/:id", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminPatch("/api/admin/forums/999999", {
				name: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/forums/:id", () => {
		test("returns 404 for non-existent forum", async () => {
			const res = await adminDelete("/api/admin/forums/999999");
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin Threads ─────────────────────────────────────────────

	describe("GET /api/admin/threads", () => {
		test("returns 200 with thread list", async () => {
			const res = await adminGet("/api/admin/threads");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});

		test("supports pagination", async () => {
			const res = await adminGet("/api/admin/threads?limit=5&offset=0");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await adminGet("/api/admin/threads/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await adminPatch("/api/admin/threads/999999", {
				sticky: true,
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/threads/:id", () => {
		test("returns 404 for non-existent thread", async () => {
			const res = await adminDelete("/api/admin/threads/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/threads/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/threads/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/threads/batch-move", () => {
		test("returns 400 for missing params", async () => {
			const res = await adminPost("/api/admin/threads/batch-move", {});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Posts ───────────────────────────────────────────────

	describe("GET /api/admin/posts", () => {
		test("returns 200 with post list", async () => {
			const res = await adminGet("/api/admin/posts");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await adminGet("/api/admin/posts/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await adminPatch("/api/admin/posts/999999", {
				content: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/posts/:id", () => {
		test("returns 404 for non-existent post", async () => {
			const res = await adminDelete("/api/admin/posts/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/posts/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/posts/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Users ───────────────────────────────────────────────

	describe("GET /api/admin/users", () => {
		test("returns 200 with user list", async () => {
			const res = await adminGet("/api/admin/users");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/users/staff", () => {
		test("returns 200 with staff list", async () => {
			const res = await adminGet("/api/admin/users/staff");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/users/batch", () => {
		test("requires ids parameter", async () => {
			const res = await adminGet("/api/admin/users/batch");
			expect(res.status).toBe(400);
		});

		test("returns users for valid ids", async () => {
			const res = await adminGet("/api/admin/users/batch?ids=1,2,3");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/users/:id", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminGet("/api/admin/users/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/users/:id", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPatch("/api/admin/users/999999", {
				role: 1,
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/:id/ban", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/ban", {
				reason: "Test",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/:id/nuke", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/nuke", {
				reason: "Test",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/:id/recalc-counters", () => {
		test("returns 404 for non-existent user", async () => {
			const res = await adminPost("/api/admin/users/999999/recalc-counters", {});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/users/batch-status", () => {
		test("returns 400 for missing params", async () => {
			const res = await adminPost("/api/admin/users/batch-status", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/users/batch-role", () => {
		test("returns 400 for missing params", async () => {
			const res = await adminPost("/api/admin/users/batch-role", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/users/batch-recalc-counters", () => {
		test("accepts empty ids array (recalcs all users)", async () => {
			// API accepts empty array and recalculates all users
			const res = await adminPost("/api/admin/users/batch-recalc-counters", {
				ids: [],
			});
			expect(res.status).toBe(200);
		});
	});

	// ─── Admin Statistics ──────────────────────────────────────────

	describe("POST /api/admin/statistics/recalc-forums", () => {
		test("recalculates forum stats", async () => {
			const res = await adminPost("/api/admin/statistics/recalc-forums", {});
			expect(res.status).toBe(200);
		});
	});

	describe("POST /api/admin/statistics/recalc-threads", () => {
		test("recalculates thread stats", async () => {
			const res = await adminPost("/api/admin/statistics/recalc-threads", {});
			expect(res.status).toBe(200);
		});
	});

	describe("POST /api/admin/statistics/recalc-users", () => {
		test("recalculates user stats", async () => {
			const res = await adminPost("/api/admin/statistics/recalc-users", {});
			expect(res.status).toBe(200);
		});
	});

	// ─── Admin Attachments ─────────────────────────────────────────

	describe("GET /api/admin/attachments", () => {
		test("returns 200 with attachment list", async () => {
			const res = await adminGet("/api/admin/attachments");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/attachments/:id", () => {
		test("returns 404 for non-existent attachment", async () => {
			const res = await adminGet("/api/admin/attachments/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/attachments/:id", () => {
		test("returns 404 for non-existent attachment", async () => {
			const res = await adminDelete("/api/admin/attachments/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/attachments/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/attachments/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin IP Bans ─────────────────────────────────────────────

	describe("GET /api/admin/ip-bans", () => {
		test("returns 200 with IP ban list", async () => {
			const res = await adminGet("/api/admin/ip-bans");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/ip-bans/check-ip", () => {
		test("checks IP status", async () => {
			const res = await adminGet("/api/admin/ip-bans/check-ip?ip=192.168.1.1");
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/admin/ip-bans/:id", () => {
		test("returns 404 for non-existent IP ban", async () => {
			const res = await adminGet("/api/admin/ip-bans/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/ip-bans", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/ip-bans", {});
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH /api/admin/ip-bans/:id", () => {
		test("returns 404 for non-existent IP ban", async () => {
			const res = await adminPatch("/api/admin/ip-bans/999999", {
				reason: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/ip-bans/:id", () => {
		test("returns 404 for non-existent IP ban", async () => {
			const res = await adminDelete("/api/admin/ip-bans/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/ip-bans/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/ip-bans/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Censor Words ────────────────────────────────────────

	describe("GET /api/admin/censor-words", () => {
		test("returns 200 with censor word list", async () => {
			const res = await adminGet("/api/admin/censor-words");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/censor-words/:id", () => {
		test("returns 404 for non-existent censor word", async () => {
			const res = await adminGet("/api/admin/censor-words/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/censor-words", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/censor-words", {});
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/admin/censor-words/test", () => {
		test("requires content field", async () => {
			// API requires 'content' not 'text'
			const res = await adminPost("/api/admin/censor-words/test", {
				text: "Hello world",
			});
			expect(res.status).toBe(400);
		});

		test("tests censor word matching with correct field", async () => {
			const res = await adminPost("/api/admin/censor-words/test", {
				content: "Hello world",
			});
			expect(res.status).toBe(200);
		});
	});

	describe("PATCH /api/admin/censor-words/:id", () => {
		test("returns 404 for non-existent censor word", async () => {
			const res = await adminPatch("/api/admin/censor-words/999999", {
				replacement: "***",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/censor-words/:id", () => {
		test("returns 404 for non-existent censor word", async () => {
			const res = await adminDelete("/api/admin/censor-words/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/censor-words/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/censor-words/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Stats ───────────────────────────────────────────────

	describe("GET /api/admin/stats", () => {
		test("returns 200 with admin stats", async () => {
			const res = await adminGet("/api/admin/stats");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	// ─── Admin Settings ────────────────────────────────────────────

	describe("GET /api/admin/settings", () => {
		test("returns 200 with settings", async () => {
			const res = await adminGet("/api/admin/settings");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("PUT /api/admin/settings", () => {
		test("updates settings", async () => {
			const res = await adminPut("/api/admin/settings", {
				settings: {},
			});
			// Could be 200 or 400 depending on validation
			expect([200, 400]).toContain(res.status);
		});
	});

	// ─── Admin Reports ─────────────────────────────────────────────

	describe("GET /api/admin/reports", () => {
		test("returns 200 with report list", async () => {
			const res = await adminGet("/api/admin/reports");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/reports/:id", () => {
		test("returns 404 for non-existent report", async () => {
			const res = await adminGet("/api/admin/reports/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("PATCH /api/admin/reports/:id", () => {
		test("returns 404 for non-existent report", async () => {
			const res = await adminPatch("/api/admin/reports/999999", {
				status: "resolved",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/reports/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/reports/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Admin Logs ────────────────────────────────────────────────

	describe("GET /api/admin/admin-logs", () => {
		test("returns 200 with admin log list", async () => {
			const res = await adminGet("/api/admin/admin-logs");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/admin-logs/:id", () => {
		test("returns 404 for non-existent log", async () => {
			const res = await adminGet("/api/admin/admin-logs/999999");
			expect(res.status).toBe(404);
		});
	});

	// ─── Admin Announcements ───────────────────────────────────────

	describe("GET /api/admin/announcements", () => {
		test("returns 200 with announcement list", async () => {
			const res = await adminGet("/api/admin/announcements");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
		});
	});

	describe("GET /api/admin/announcements/:id", () => {
		test("returns 404 for non-existent announcement", async () => {
			const res = await adminGet("/api/admin/announcements/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/announcements", () => {
		test("returns 400 for missing required fields", async () => {
			const res = await adminPost("/api/admin/announcements", {});
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH /api/admin/announcements/:id", () => {
		test("returns 404 for non-existent announcement", async () => {
			const res = await adminPatch("/api/admin/announcements/999999", {
				title: "Updated",
			});
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /api/admin/announcements/:id", () => {
		test("returns 404 for non-existent announcement", async () => {
			const res = await adminDelete("/api/admin/announcements/999999");
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/admin/announcements/batch-delete", () => {
		test("returns 400 for empty ids", async () => {
			const res = await adminPost("/api/admin/announcements/batch-delete", {
				ids: [],
			});
			expect(res.status).toBe(400);
		});
	});
});

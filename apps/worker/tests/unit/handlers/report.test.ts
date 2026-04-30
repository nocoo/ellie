import { describe, expect, it } from "vitest";
import {
	REPORT_REASONS,
	checkPermission,
	create,
	optionsPostingPermission,
	optionsReports,
} from "../../../src/handlers/report";
import { createJwt } from "../../../src/lib/jwt";
import { TEST_JWT_SECRET, createMockDb, makeEnv } from "../../helpers";

// ─── Helpers ──────────────────────────────────────────────────────

async function makeUserToken(userId = 1, role = 0): Promise<string> {
	return createJwt({ userId, role, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_JWT_SECRET);
}

function reportRequest(method: string, path: string, token?: string, body?: unknown): Request {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return new Request(`https://api.example.com${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

// ─── Constants Export ─────────────────────────────────────────────

describe("REPORT_REASONS constant", () => {
	it("should export all preset reasons", () => {
		expect(REPORT_REASONS).toContain("垃圾广告");
		expect(REPORT_REASONS).toContain("违规内容");
		expect(REPORT_REASONS).toContain("人身攻击");
		expect(REPORT_REASONS).toContain("虚假信息");
		expect(REPORT_REASONS).toContain("侵权内容");
		expect(REPORT_REASONS).toContain("其他");
		expect(REPORT_REASONS.length).toBe(6);
	});
});

// ─── OPTIONS handlers ─────────────────────────────────────────────

describe("OPTIONS /api/v1/reports", () => {
	it("should return 204 with CORS headers", () => {
		const req = reportRequest("OPTIONS", "/api/v1/reports");
		const res = optionsReports(req);
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
	});
});

describe("OPTIONS /api/v1/posting-permission", () => {
	it("should return 204 with CORS headers", () => {
		const req = reportRequest("OPTIONS", "/api/v1/posting-permission");
		const res = optionsPostingPermission(req);
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
	});
});

// ─── POST /api/v1/reports ─────────────────────────────────────────

describe("POST /api/v1/reports", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = reportRequest("POST", "/api/v1/reports", undefined, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeUserToken();
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/reports", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: "invalid json",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("INVALID_BODY");
	});

	it("should return 400 for non-post type", async () => {
		const token = await makeUserToken();
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "thread",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(data.error.details?.message).toContain("post");
	});

	it("should return 400 for invalid targetId", async () => {
		const token = await makeUserToken();
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: "abc",
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(data.error.details?.message).toContain("targetId");
	});

	it("should return 400 for invalid reason", async () => {
		const token = await makeUserToken();
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "无效理由",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(data.error.details?.message).toContain("reason");
	});

	it("should return 403 when user is banned", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: -1 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: -1,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 404 when post not found", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				// Post query returns null (not found)
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 999,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("TARGET_NOT_FOUND");
	});

	it("should return 404 for invisible post (deleted/pending)", async () => {
		const token = await makeUserToken(1, 0);
		// The post query includes "invisible = 0", so invisible posts won't be found
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				// Post with invisible != 0 won't be returned by the query
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("TARGET_NOT_FOUND");
	});

	it("should return 404 for post in hidden thread (sticky < 0)", async () => {
		const token = await makeUserToken(1, 0);
		// Post exists but its thread has sticky < 0 (hidden/deleted/placeholder)
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, thread_id, author_id FROM posts": { id: 1, thread_id: 1, author_id: 2 },
				// Thread query includes "sticky >= 0", so hidden threads won't be found
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("TARGET_NOT_FOUND");
	});

	it("should return 400 when reporting own post", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, thread_id, author_id FROM posts": { id: 1, thread_id: 1, author_id: 1 }, // Same as userId
				"SELECT forum_id FROM threads": { forum_id: 1 },
				"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
			},
			allResults: {
				"SELECT key, value FROM settings": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CANNOT_REPORT_SELF");
	});

	it("should return 400 for duplicate report within 24h", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, thread_id, author_id FROM posts": { id: 1, thread_id: 1, author_id: 2 },
				"SELECT forum_id FROM threads": { forum_id: 1 },
				"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
				"SELECT 1 FROM reports WHERE reporter_id": { 1: 1 }, // Existing report
			},
			allResults: {
				"SELECT key, value FROM settings": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("DUPLICATE_REPORT");
	});

	it("should create report successfully", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, thread_id, author_id FROM posts": { id: 1, thread_id: 1, author_id: 2 },
				"SELECT forum_id FROM threads": { forum_id: 1 },
				"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
				// No existing report (returns null by default)
				"SELECT username FROM users": { username: "testuser" },
			},
			allResults: {
				"SELECT key, value FROM settings": [],
			},
			runResults: {
				"INSERT INTO reports": { success: true, meta: { last_row_id: 42, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "post",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(201);
		const data = (await res.json()) as { data: { id: number; type: string; reason: string } };
		expect(data.data.id).toBe(42);
		expect(data.data.type).toBe("post");
		expect(data.data.reason).toBe("垃圾广告");
	});
});

// ─── GET /api/v1/posting-permission ───────────────────────────────

describe("GET /api/v1/posting-permission", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = reportRequest("GET", "/api/v1/posting-permission");
		const res = await checkPermission(req, env);
		expect(res.status).toBe(401);
	});

	it("should return allowed: true for normal user", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
			},
			allResults: {
				"SELECT key, value FROM settings": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("GET", "/api/v1/posting-permission", token);
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean } };
		expect(data.data.allowed).toBe(true);
	});

	it("should return allowed: false with reason for banned user", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: -1 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: -1, // Banned
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("GET", "/api/v1/posting-permission", token);
		const res = await checkPermission(req, env);
		// withAuthVerified rejects banned users with 403 USER_BANNED
		expect(res.status).toBe(403);
	});

	it("should return allowed: false with reason for muted user", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: -2 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: -2, // Muted
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("GET", "/api/v1/posting-permission", token);
		const res = await checkPermission(req, env);
		// withAuthVerified rejects muted users with 403 USER_BANNED
		expect(res.status).toBe(403);
	});

	it("should return allowed: false with reason for new user when restriction enabled", async () => {
		const token = await makeUserToken(1, 0);
		const now = Math.floor(Date.now() / 1000);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: now, // Just registered
					role: 0,
				},
			},
			allResults: {
				"SELECT key, value FROM settings": [
					{ key: "features.posting.enabled", value: "true" },
					{ key: "features.posting.min_registration_days", value: "7" },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("GET", "/api/v1/posting-permission", token);
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean; reason: string } };
		expect(data.data.allowed).toBe(false);
		expect(data.data.reason).toBeTruthy();
	});
});

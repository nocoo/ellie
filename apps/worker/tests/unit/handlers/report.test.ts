import { describe, expect, it } from "vitest";
import {
	checkPermission,
	create,
	optionsPostingPermission,
	optionsReports,
	REPORT_REASONS,
} from "../../../src/handlers/report";
import { createJwt } from "../../../src/lib/jwt";
import { createMockDb, makeEnv, TEST_JWT_SECRET } from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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

	it("should return 400 for unknown type", async () => {
		const token = await makeUserToken();
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "forum",
			targetId: 1,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(data.error.code).toBe("INVALID_REQUEST");
		expect(data.error.details?.message).toContain("type");
	});

	it("should return 400 for invalid targetId", async () => {
		const token = await makeUserToken();
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: -1, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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

	// ─── thread type ────────────────────────────────────────────

	it("should create thread report successfully", async () => {
		const token = await makeUserToken(1, 0);
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, forum_id, author_id FROM threads": {
					id: 5,
					forum_id: 1,
					author_id: 2,
				},
				"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
				"SELECT username FROM users": { username: "testuser" },
			},
			allResults: {
				"SELECT key, value FROM settings": [],
			},
			runResults: {
				"INSERT INTO reports": { success: true, meta: { last_row_id: 7, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "thread",
			targetId: 5,
			reason: "违规内容",
		});
		const res = await create(req, env);
		expect(res.status).toBe(201);
		const data = (await res.json()) as { data: { id: number; type: string; targetId: number } };
		expect(data.data.type).toBe("thread");
		expect(data.data.targetId).toBe(5);
		// INSERT bind must use type from body, not hard-coded "post"
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO reports"));
		expect(insertCall?.params[0]).toBe("thread");
		// Dedup SQL must bind type, not literal
		const dedupCall = calls.find(
			(c) => c.sql.includes("FROM reports") && c.sql.includes("reporter_id"),
		);
		expect(dedupCall?.params[1]).toBe("thread");
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				// Thread query returns null
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "thread",
			targetId: 999,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("TARGET_NOT_FOUND");
	});

	it("should return 400 when reporting own thread", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, forum_id, author_id FROM threads": {
					id: 5,
					forum_id: 1,
					author_id: 1, // same as reporter
				},
				"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "thread",
			targetId: 5,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CANNOT_REPORT_SELF");
	});

	it("should return 400 for duplicate thread report within 24h", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, forum_id, author_id FROM threads": {
					id: 5,
					forum_id: 1,
					author_id: 2,
				},
				"SELECT status, visibility FROM forums": { status: 1, visibility: "public" },
				"SELECT 1 FROM reports WHERE reporter_id": { 1: 1 },
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "thread",
			targetId: 5,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("DUPLICATE_REPORT");
	});

	// ─── user type ──────────────────────────────────────────────

	it("should create user report successfully", async () => {
		const token = await makeUserToken(1, 0);
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, status FROM users": { id: 9, status: 0 },
				"SELECT username FROM users": { username: "testuser" },
			},
			allResults: { "SELECT key, value FROM settings": [] },
			runResults: {
				"INSERT INTO reports": { success: true, meta: { last_row_id: 11, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "user",
			targetId: 9,
			reason: "人身攻击",
		});
		const res = await create(req, env);
		expect(res.status).toBe(201);
		const data = (await res.json()) as { data: { id: number; type: string; targetId: number } };
		expect(data.data.type).toBe("user");
		expect(data.data.targetId).toBe(9);
		const insertCall = calls.find((c) => c.sql.includes("INSERT INTO reports"));
		expect(insertCall?.params[0]).toBe("user");
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				// "SELECT id, status FROM users" returns null
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "user",
			targetId: 999,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 404 when target user is tombstoned", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, status FROM users": { id: 9, status: -99 },
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "user",
			targetId: 9,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("TARGET_NOT_FOUND");
	});

	it("should return 400 when reporting self (user type)", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, status FROM users": { id: 1, status: 0 },
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "user",
			targetId: 1, // self
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("CANNOT_REPORT_SELF");
	});

	it("should return 400 for duplicate user report within 24h", async () => {
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
				"SELECT id, status FROM users": { id: 9, status: 0 },
				"SELECT 1 FROM reports WHERE reporter_id": { 1: 1 },
			},
			allResults: { "SELECT key, value FROM settings": [] },
		});
		const env = makeEnv({ DB: db });
		const req = reportRequest("POST", "/api/v1/reports", token, {
			type: "user",
			targetId: 9,
			reason: "垃圾广告",
		});
		const res = await create(req, env);
		expect(res.status).toBe(400);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("DUPLICATE_REPORT");
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
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT email_verified_at": { email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: -1, email_verified_at: 1700000000 },
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
				"SELECT role, status": { role: 0, status: -2, email_verified_at: 1700000000 },
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

	it("should return allowed: false with reason and code for new user when restriction enabled", async () => {
		const token = await makeUserToken(1, 0);
		const now = Math.floor(Date.now() / 1000);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT email_verified_at": { email_verified_at: 1700000000 },
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
		const data = (await res.json()) as {
			data: { allowed: boolean; reason: string; code: string };
		};
		expect(data.data.allowed).toBe(false);
		expect(data.data.reason).toBeTruthy();
		expect(data.data.code).toBeTruthy();
	});
});

describe("report handlers — §5.4 email-verification gate", () => {
	it("create: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await create(
			new Request("https://example.com/api/v1/reports", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ targetType: "post", targetId: 1, reason: "spam" }),
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("checkPermission: unverified user gets { allowed: false, code: EMAIL_NOT_VERIFIED }", async () => {
		// After the write-gate unification, checkPermission now checks email
		// verification at the handler level (not via withVerifiedEmail middleware).
		// An unverified user should get the posting-permission JSON format back
		// (200 with allowed: false), NOT the §5.4 flat 403 payload.
		const token = await makeUserToken(1, 0);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 0 },
				"SELECT email_verified_at": { email_verified_at: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const response = await checkPermission(
			new Request("https://example.com/api/v1/posting-permission", {
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
		expect(response.status).toBe(200);
		const data = (await response.json()) as {
			data: { allowed: boolean; reason: string; code: string };
		};
		expect(data.data.allowed).toBe(false);
		expect(data.data.code).toBe("EMAIL_NOT_VERIFIED");
		expect(data.data.reason).toBeTruthy();
	});
});

// ─── Action-specific posting permission checks ─────────────────

describe("GET /api/v1/posting-permission — action parameter", () => {
	/** Helper: create a verified user with settings that disable thread/reply */
	function makeEnvWithContentSwitches(opts: { allowNewThread?: boolean; allowReply?: boolean }) {
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT email_verified_at": { email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "avatars/test.jpg",
					has_avatar: 0,
					reg_date: 0,
					role: 0,
				},
			},
			allResults: {
				"SELECT key, value FROM settings": [
					...(opts.allowNewThread === false
						? [{ key: "features.content.allow_new_thread", value: "false" }]
						: []),
					...(opts.allowReply === false
						? [{ key: "features.content.allow_reply", value: "false" }]
						: []),
				],
			},
		});
		return makeEnv({ DB: db });
	}

	it("action=thread blocked when allow_new_thread=false", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowNewThread: false });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=thread", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean; code: string } };
		expect(data.data.allowed).toBe(false);
		expect(data.data.code).toBe("CONTENT_DISABLED");
	});

	it("action=reply blocked when allow_reply=false", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowReply: false });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=reply", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean; code: string } };
		expect(data.data.allowed).toBe(false);
		expect(data.data.code).toBe("CONTENT_DISABLED");
	});

	it("action=comment blocked when allow_reply=false (maps to reply)", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowReply: false });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=comment", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean; code: string } };
		expect(data.data.allowed).toBe(false);
		expect(data.data.code).toBe("CONTENT_DISABLED");
	});

	it("action=message NOT blocked by allow_new_thread=false", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowNewThread: false, allowReply: false });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=message", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean } };
		expect(data.data.allowed).toBe(true);
	});

	it("action=report NOT blocked by allow_new_thread or allow_reply switches", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowNewThread: false, allowReply: false });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=report", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean } };
		expect(data.data.allowed).toBe(true);
	});

	it("no action parameter defaults to message (not blocked by content switches)", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowNewThread: false, allowReply: false });
		const req = new Request("https://api.example.com/api/v1/posting-permission", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean } };
		expect(data.data.allowed).toBe(true);
	});

	it("action=thread allowed when allow_new_thread=true (default)", async () => {
		const token = await makeUserToken(1, 0);
		const env = makeEnvWithContentSwitches({ allowNewThread: true });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=thread", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean } };
		expect(data.data.allowed).toBe(true);
	});

	it("action=thread NOT blocked when user is staff (role >= 1)", async () => {
		const token = await makeUserToken(1, 1); // role=1 (Mod)
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 1, status: 0, email_verified_at: 1700000000 },
				"SELECT email_verified_at": { email_verified_at: 1700000000 },
				"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
					status: 0,
					avatar_path: "",
					has_avatar: 0,
					reg_date: 0,
					role: 1,
				},
			},
			allResults: {
				"SELECT key, value FROM settings": [
					{ key: "features.content.allow_new_thread", value: "false" },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/posting-permission?action=thread", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await checkPermission(req, env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { allowed: boolean } };
		expect(data.data.allowed).toBe(true);
	});
});

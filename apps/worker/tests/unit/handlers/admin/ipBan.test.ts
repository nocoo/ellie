import { describe, expect, it } from "bun:test";
import {
	batchDelete,
	checkIp,
	create,
	getById,
	list,
	remove,
	update,
} from "../../../../src/handlers/admin/ipBan";
import { createAdminRequest, createJwtForRole, createMockDb, makeEnv } from "../../../helpers";

// ─── Helpers ────────────────────────────────────────────────

function makeIpBanRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		ip: "10.0.0.1",
		admin_id: 1,
		admin_name: "admin",
		reason: "spam",
		expires_at: null,
		created_at: 1711540800,
		...overrides,
	};
}

// ─── list ───────────────────────────────────────────────────

describe("admin ipBan handlers", () => {
	describe("list", () => {
		it("should require auth", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });

			const response = await list(new Request("https://api.example.com/api/admin/ip-bans"), env);

			expect(response.status).toBe(401);
		});

		it("should reject non-admin users", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans", undefined, 0);

			const response = await list(request, env);

			expect(response.status).toBe(403);
		});

		it("should return paginated results", async () => {
			const rows = [makeIpBanRow({ id: 1 }), makeIpBanRow({ id: 2, ip: "10.0.0.2" })];
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 2 } },
				allResults: { "SELECT id, ip, admin_id": rows },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			expect((body.data as unknown[]).length).toBe(2);
			expect((body.meta as Record<string, unknown>).total).toBe(2);
			expect((body.meta as Record<string, unknown>).page).toBe(1);
		});

		it("should filter by ip (LIKE)", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 1 } },
				allResults: { "SELECT id, ip, admin_id": [makeIpBanRow()] },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans?ip=10.0");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("ip LIKE ?");
			expect(countCall?.params[0]).toBe("%10.0%");
		});

		it("should exclude expired bans by default", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 0 } },
				allResults: { "SELECT id, ip, admin_id": [] },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans");

			await list(request, env);

			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("expires_at IS NULL OR expires_at > ?");
		});

		it("should include expired bans when expired=true", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 0 } },
				allResults: { "SELECT id, ip, admin_id": [] },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans?expired=true");

			await list(request, env);

			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).not.toContain("expires_at");
		});
	});

	// ─── getById ────────────────────────────────────────────

	describe("getById", () => {
		it("should return an ip ban by id", async () => {
			const row = makeIpBanRow({ id: 5 });
			const { db } = createMockDb({
				firstResults: { "SELECT id, ip, admin_id": row },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans/5");

			const response = await getById(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.id).toBe(5);
			expect(data.ip).toBe("10.0.0.1");
		});

		it("should return 404 for non-existent ban", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans/999");

			const response = await getById(request, env);

			expect(response.status).toBe(404);
		});
	});

	// ─── create ─────────────────────────────────────────────

	describe("create", () => {
		it("should create a valid ip ban", async () => {
			const row = makeIpBanRow({ ip: "192.168.1.100" });
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": null, // no duplicate
					"SELECT username FROM users WHERE id": { username: "admin" },
					"SELECT id, ip, admin_id": row, // re-fetch after INSERT
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/ip-bans", {
				ip: "192.168.1.100",
				reason: "abuse",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
		});

		it("should reject duplicate IP", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": { id: 1 }, // duplicate exists
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/ip-bans", {
				ip: "10.0.0.1",
			});

			const response = await create(request, env);

			expect(response.status).toBe(409);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("IP_BAN_DUPLICATE");
		});

		it("should include CORS headers in beforeCreate hook error", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": { id: 1 },
				},
			});
			const env = makeEnv({ DB: db });
			const token = await createJwtForRole(1);
			const response = await create(
				new Request("https://api.example.com/api/admin/ip-bans", {
					method: "POST",
					headers: {
						"X-API-Key": "test-api-key",
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
						Origin: "http://localhost:3000",
					},
					body: JSON.stringify({ ip: "10.0.0.1" }),
				}),
				env,
			);

			expect(response.status).toBe(409);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});

		it("should reject self-ban when CF-Connecting-IP matches", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM ip_bans WHERE ip": null },
			});
			const env = makeEnv({ DB: db });
			const jwt = await createJwtForRole(1);
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
					Authorization: `Bearer ${jwt}`,
					"Content-Type": "application/json",
					"CF-Connecting-IP": "10.0.0.1",
				},
				body: JSON.stringify({ ip: "10.0.0.1" }),
			});

			const response = await create(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("IP_BAN_SELF");
		});

		it("should reject self-ban via CIDR range covering own IP", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM ip_bans WHERE ip": null },
			});
			const env = makeEnv({ DB: db });
			const jwt = await createJwtForRole(1);
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
					Authorization: `Bearer ${jwt}`,
					"Content-Type": "application/json",
					"CF-Connecting-IP": "192.168.1.50",
				},
				body: JSON.stringify({ ip: "192.168.1.0/24" }),
			});

			const response = await create(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("IP_BAN_SELF");
		});

		it("should reject self-ban via wildcard pattern covering own IP", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM ip_bans WHERE ip": null },
			});
			const env = makeEnv({ DB: db });
			const jwt = await createJwtForRole(1);
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
					Authorization: `Bearer ${jwt}`,
					"Content-Type": "application/json",
					"CF-Connecting-IP": "10.0.5.6",
				},
				body: JSON.stringify({ ip: "10.0.*.*" }),
			});

			const response = await create(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("IP_BAN_SELF");
		});

		it("should auto-fill admin_id, admin_name, and created_at", async () => {
			const row = makeIpBanRow({ ip: "172.16.0.1", admin_name: "superadmin" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": null,
					"SELECT username FROM users WHERE id": { username: "superadmin" },
					"SELECT id, ip, admin_id": row,
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/ip-bans", {
				ip: "172.16.0.1",
				reason: "test",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
			const insertCall = calls.find((c) => c.sql.includes("INSERT"));
			expect(insertCall).toBeDefined();
			// admin_name should be in the inserted params
			expect(insertCall?.params).toContain("superadmin");
		});
	});

	// ─── update ─────────────────────────────────────────────

	describe("update", () => {
		it("should update reason and expiresAt", async () => {
			const row = makeIpBanRow({ id: 3 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM ip_bans WHERE id": row, // fetchRowFull
					"SELECT id, ip, admin_id": row, // re-fetch after UPDATE
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/ip-bans/3", {
				reason: "updated reason",
				expiresAt: 1800000000,
			});

			const response = await update(request, env);

			expect(response.status).toBe(200);
		});

		it("should return 404 for non-existent ban", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/ip-bans/999", {
				reason: "nope",
			});

			const response = await update(request, env);

			expect(response.status).toBe(404);
		});
	});

	// ─── remove ─────────────────────────────────────────────

	describe("remove", () => {
		it("should delete an ip ban", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM ip_bans WHERE id": makeIpBanRow({ id: 7 }) },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("DELETE", "/api/admin/ip-bans/7");

			const response = await remove(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.deleted).toBe(true);
			expect(data.id).toBe(7);
		});

		it("should return 404 for non-existent ban", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("DELETE", "/api/admin/ip-bans/999");

			const response = await remove(request, env);

			expect(response.status).toBe(404);
		});
	});

	// ─── batchDelete ────────────────────────────────────────

	describe("batchDelete", () => {
		it("should batch delete ip bans", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM ip_bans WHERE id": makeIpBanRow() },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/ip-bans/batch-delete", {
				ids: [1, 2, 3],
			});

			const response = await batchDelete(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.deleted).toBe(true);
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/ip-bans/batch-delete", {
				ids: [],
			});

			const response = await batchDelete(request, env);

			expect(response.status).toBe(400);
		});
	});

	// ─── checkIp ────────────────────────────────────────────

	describe("checkIp", () => {
		it("should detect exact match", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [makeIpBanRow({ id: 1, ip: "10.0.0.1" })],
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=10.0.0.1");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(true);
			expect((data.matchedRule as Record<string, unknown>).ip).toBe("10.0.0.1");
		});

		it("should detect CIDR match", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [makeIpBanRow({ id: 1, ip: "192.168.0.0/24" })],
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest(
				"GET",
				"/api/admin/ip-bans/check-ip?ip=192.168.0.100",
			);

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(true);
			expect((data.matchedRule as Record<string, unknown>).ip).toBe("192.168.0.0/24");
		});

		it("should detect wildcard match", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [makeIpBanRow({ id: 1, ip: "10.0.*.*" })],
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=10.0.5.6");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(true);
			expect((data.matchedRule as Record<string, unknown>).ip).toBe("10.0.*.*");
		});

		it("should return banned=false when no match", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [makeIpBanRow({ id: 1, ip: "10.0.0.1" })],
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=172.16.0.1");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(false);
		});

		it("should require ip query parameter", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/ip-bans/check-ip");

			const response = await checkIp(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_REQUEST");
		});
	});
});

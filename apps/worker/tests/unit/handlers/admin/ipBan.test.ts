import { describe, expect, it } from "vitest";
import {
	batchDelete,
	checkIp,
	create,
	getById,
	list,
	remove,
	update,
} from "../../../../src/handlers/admin/ipBan";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

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
		it("should return paginated results", async () => {
			const rows = [makeIpBanRow({ id: 1 }), makeIpBanRow({ id: 2, ip: "10.0.0.2" })];
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 2 } },
				allResults: { "SELECT id, ip, admin_id": rows },
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans?ip=10.0");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans?expired=true");

			await list(request, env);

			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).not.toContain("expires_at");
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans?page=0");

			const response = await list(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_REQUEST");
		});

		it("should reject NaN page", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans?page=abc");

			const response = await list(request, env);

			expect(response.status).toBe(400);
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
			const request = createAdminRequest("GET", "/api/admin/ip-bans/5");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans/999");

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
					"SELECT id, ip, admin_id": row, // re-fetch after INSERT
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/ip-bans", {
				ip: "192.168.1.100",
				reason: "abuse",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
		});

		it("should reject invalid JSON body", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
					"Content-Type": "application/json",
				},
				body: "not valid json{",
			});

			const response = await create(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_BODY");
		});

		it("should reject duplicate IP", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": { id: 1 }, // duplicate exists
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/ip-bans", {
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
			const response = await create(
				new Request("https://api.example.com/api/admin/ip-bans", {
					method: "POST",
					headers: {
						"X-API-Key": "test-api-key",
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
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
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
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
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
			const request = new Request("https://api.example.com/api/admin/ip-bans", {
				method: "POST",
				headers: {
					"X-API-Key": "test-api-key",
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
			const row = makeIpBanRow({ ip: "172.16.0.1", admin_name: "System" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": null,
					"SELECT id, ip, admin_id": row,
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("POST", "/api/admin/ip-bans", {
				ip: "172.16.0.1",
				reason: "test",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
			const insertCall = calls.find((c) => c.sql.includes("INSERT"));
			expect(insertCall).toBeDefined();
			// admin_name should be in the inserted params
			expect(insertCall?.params).toContain("System");
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
			const request = createAdminRequest("PATCH", "/api/admin/ip-bans/3", {
				reason: "updated reason",
				expiresAt: 1800000000,
			});

			const response = await update(request, env);

			expect(response.status).toBe(200);
		});

		it("should return 404 for non-existent ban", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("PATCH", "/api/admin/ip-bans/999", {
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
			const request = createAdminRequest("DELETE", "/api/admin/ip-bans/7");

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
			const request = createAdminRequest("DELETE", "/api/admin/ip-bans/999");

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
			const request = createAdminRequest("POST", "/api/admin/ip-bans/batch-delete", {
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
			const request = createAdminRequest("POST", "/api/admin/ip-bans/batch-delete", {
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
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=10.0.0.1");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=192.168.0.100");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=10.0.5.6");

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
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=172.16.0.1");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(false);
		});

		it("should return exact match over CIDR and wildcard", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [
						makeIpBanRow({ id: 1, ip: "10.0.*.*" }),
						makeIpBanRow({ id: 2, ip: "10.0.0.0/24" }),
						makeIpBanRow({ id: 3, ip: "10.0.0.5" }),
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=10.0.0.5");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(true);
			expect((data.matchedRule as Record<string, unknown>).ip).toBe("10.0.0.5");
		});

		it("should return longer CIDR prefix over shorter", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [
						makeIpBanRow({ id: 1, ip: "192.168.0.0/16" }),
						makeIpBanRow({ id: 2, ip: "192.168.1.0/24" }),
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=192.168.1.50");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(true);
			expect((data.matchedRule as Record<string, unknown>).ip).toBe("192.168.1.0/24");
		});

		it("should return CIDR over wildcard", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, ip, admin_id": [
						makeIpBanRow({ id: 1, ip: "10.*.*.*" }),
						makeIpBanRow({ id: 2, ip: "10.0.0.0/8" }),
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip?ip=10.0.0.5");

			const response = await checkIp(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.banned).toBe(true);
			// CIDR /8 has specificity 8, wildcard 10.*.*.* has specificity 1
			expect((data.matchedRule as Record<string, unknown>).ip).toBe("10.0.0.0/8");
		});

		it("should require ip query parameter", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = createAdminRequest("GET", "/api/admin/ip-bans/check-ip");

			const response = await checkIp(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_REQUEST");
		});
	});

	// ─── F3-c: audit instrumentation ─────────────────────────────────

	describe("F3-c audit instrumentation", () => {
		function actorReq(method: string, path: string, body?: unknown): Request {
			return new Request(`https://api.example.com${path}`, {
				method,
				headers: {
					"X-API-Key": "test-api-key",
					"Content-Type": "application/json",
					"X-Admin-Actor-Email": "alice@example.com",
					"X-Admin-Actor-Name": "Alice",
					"CF-Connecting-IP": "5.6.7.8",
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		}

		function findAuditInsert(calls: { sql: string; params: unknown[] }[]) {
			return calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		}

		it("POST writes ip_ban.create with plaintext ip/reason/expiresAt", async () => {
			const row = makeIpBanRow({ id: 42, ip: "192.0.2.10" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM ip_bans WHERE ip": null,
					"SELECT id, ip, admin_id": row,
				},
			});
			const env = makeEnv({ DB: db });
			const res = await create(
				actorReq("POST", "/api/admin/ip-bans", {
					ip: "192.0.2.10",
					reason: "abuse",
					expiresAt: 1900000000,
				}),
				env,
			);
			expect(res.status).toBe(201);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("ip_ban.create");
			expect(insert?.params[3]).toBe("ip_ban");
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.ip).toBe("192.0.2.10");
			expect(details.reason).toBe("abuse");
			expect(details.expiresAt).toBe(1900000000);
		});

		it("PATCH writes ip_ban.update with reason diff and ip context", async () => {
			const existing = makeIpBanRow({ id: 3, ip: "10.0.0.1", reason: "old" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM ip_bans WHERE id": existing,
					"SELECT id, ip, admin_id": existing,
				},
			});
			const env = makeEnv({ DB: db });
			const res = await update(actorReq("PATCH", "/api/admin/ip-bans/3", { reason: "new" }), env);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("ip_ban.update");
			expect(insert?.params[4]).toBe(3);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.ip).toBe("10.0.0.1");
			expect(details.changedFields).toEqual(["reason"]);
			expect(details.before.reason).toBe("old");
			expect(details.after.reason).toBe("new");
		});

		it("PATCH no-op (same reason) does NOT write audit row", async () => {
			const existing = makeIpBanRow({ id: 3, reason: "same" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM ip_bans WHERE id": existing,
					"SELECT id, ip, admin_id": existing,
				},
			});
			const env = makeEnv({ DB: db });
			const res = await update(actorReq("PATCH", "/api/admin/ip-bans/3", { reason: "same" }), env);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});

		it("DELETE writes ip_ban.delete with snapshot", async () => {
			const existing = makeIpBanRow({ id: 7, ip: "10.0.0.7", reason: "spam" });
			const { db, calls } = createMockDb({
				firstResults: { "SELECT * FROM ip_bans WHERE id": existing },
			});
			const env = makeEnv({ DB: db });
			const res = await remove(actorReq("DELETE", "/api/admin/ip-bans/7"), env);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("ip_ban.delete");
			expect(insert?.params[4]).toBe(7);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.ip).toBe("10.0.0.7");
			expect(details.reason).toBe("spam");
		});

		it("batch-delete writes ip_ban.batch_delete only when existing > 0", async () => {
			const { db, calls } = createMockDb({
				allResults: {
					"SELECT id, ip FROM ip_bans WHERE id IN": [
						{ id: 1, ip: "10.0.0.1" },
						{ id: 2, ip: "10.0.0.2" },
					],
				},
				firstResults: { "SELECT * FROM ip_bans WHERE id": makeIpBanRow() },
			});
			const env = makeEnv({ DB: db });
			const res = await batchDelete(
				actorReq("POST", "/api/admin/ip-bans/batch-delete", { ids: [1, 2] }),
				env,
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("ip_ban.batch_delete");
			expect(insert?.params[4]).toBeNull();
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.ids).toEqual([1, 2]);
			expect(details.ips).toEqual(["10.0.0.1", "10.0.0.2"]);
			expect(details.count).toBe(2);
		});

		it("batch-delete with no existing rows does NOT write audit row", async () => {
			const { db, calls } = createMockDb({
				allResults: { "SELECT id, ip FROM ip_bans WHERE id IN": [] },
				firstResults: { "SELECT * FROM ip_bans WHERE id": makeIpBanRow() },
			});
			const env = makeEnv({ DB: db });
			const res = await batchDelete(
				actorReq("POST", "/api/admin/ip-bans/batch-delete", { ids: [999] }),
				env,
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});
	});
});

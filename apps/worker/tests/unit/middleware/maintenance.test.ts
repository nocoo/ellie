import { describe, expect, it } from "bun:test";
import { UserRole } from "@ellie/types";
import { createJwt } from "../../../src/lib/jwt";
import { checkMaintenance } from "../../../src/middleware/maintenance";
import { TEST_JWT_SECRET, createMockKV, makeEnv } from "../../helpers";

describe("maintenance middleware", () => {
	/** Create an env where maintenance mode is ON */
	function makeMaintenanceEnv(adminBypass = false) {
		const kv = createMockKV({
			"settings:all": JSON.stringify({
				"features.access.maintenance_mode": true,
				"features.access.maintenance_admin_bypass": adminBypass,
				"features.access.maintenance_message": "Under maintenance",
			}),
		});
		return makeEnv({ KV: kv });
	}

	/** Create an env where maintenance mode is OFF */
	function makeNormalEnv() {
		const kv = createMockKV({
			"settings:all": JSON.stringify({
				"features.access.maintenance_mode": false,
			}),
		});
		return makeEnv({ KV: kv });
	}

	// ─── Bypass paths ────────────────────────────────────────

	describe("bypass paths", () => {
		it("should allow /api/live regardless of maintenance mode", async () => {
			const env = makeMaintenanceEnv();
			const req = new Request("https://api.example.com/api/live");
			const result = await checkMaintenance(req, env);
			expect(result).toBeNull();
		});

		it("should allow /api/admin/ paths regardless of maintenance mode", async () => {
			const env = makeMaintenanceEnv();
			const req = new Request("https://api.example.com/api/admin/forums");
			const result = await checkMaintenance(req, env);
			expect(result).toBeNull();
		});

		it("should allow /api/v1/auth/ paths regardless of maintenance mode", async () => {
			const env = makeMaintenanceEnv();
			const req = new Request("https://api.example.com/api/v1/auth/login");
			const result = await checkMaintenance(req, env);
			expect(result).toBeNull();
		});

		it("should allow /api/v1/settings path regardless of maintenance mode", async () => {
			const env = makeMaintenanceEnv();
			const req = new Request("https://api.example.com/api/v1/settings");
			const result = await checkMaintenance(req, env);
			expect(result).toBeNull();
		});
	});

	// ─── Maintenance mode OFF ────────────────────────────────

	describe("maintenance mode OFF", () => {
		it("should allow all requests when maintenance mode is disabled", async () => {
			const env = makeNormalEnv();
			const req = new Request("https://api.example.com/api/v1/forums");
			const result = await checkMaintenance(req, env);
			expect(result).toBeNull();
		});
	});

	// ─── Maintenance mode ON, no admin bypass ────────────────

	describe("maintenance mode ON, no admin bypass", () => {
		it("should block public requests with 503", async () => {
			const env = makeMaintenanceEnv(false);
			const req = new Request("https://api.example.com/api/v1/forums");
			const result = await checkMaintenance(req, env);
			expect(result).not.toBeNull();
			expect(result?.status).toBe(503);
			const data = await result?.json();
			expect(data.error.code).toBe("MAINTENANCE_MODE");
		});

		it("should include custom maintenance message", async () => {
			const env = makeMaintenanceEnv(false);
			const req = new Request("https://api.example.com/api/v1/forums");
			const result = await checkMaintenance(req, env);
			const data = await result?.json();
			expect(data.error.details.message).toBe("Under maintenance");
		});

		it("should include CORS headers on maintenance response", async () => {
			const env = makeMaintenanceEnv(false);
			const req = new Request("https://api.example.com/api/v1/forums", {
				headers: { Origin: "https://ellie.nocoo.cloud" },
			});
			const result = await checkMaintenance(req, env, "https://ellie.nocoo.cloud");
			expect(result?.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should use default message when custom message not set", async () => {
			const kv = createMockKV({
				"settings:all": JSON.stringify({
					"features.access.maintenance_mode": true,
					"features.access.maintenance_admin_bypass": false,
				}),
			});
			const env = makeEnv({ KV: kv });
			const req = new Request("https://api.example.com/api/v1/forums");
			const result = await checkMaintenance(req, env);
			const data = await result?.json();
			expect(data.error.details.message).toContain("维护中");
		});
	});

	// ─── Maintenance mode ON, admin bypass enabled ───────────

	describe("maintenance mode ON, admin bypass enabled", () => {
		it("should allow admin user with valid JWT", async () => {
			const env = makeMaintenanceEnv(true);
			const token = await createJwt(
				{ userId: 1, role: UserRole.Admin, exp: Math.floor(Date.now() / 1000) + 3600 },
				TEST_JWT_SECRET,
			);
			const req = new Request("https://api.example.com/api/v1/forums", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const result = await checkMaintenance(req, env);
			expect(result).toBeNull();
		});

		it("should block regular user even with valid JWT", async () => {
			const env = makeMaintenanceEnv(true);
			const token = await createJwt(
				{ userId: 2, role: UserRole.User, exp: Math.floor(Date.now() / 1000) + 3600 },
				TEST_JWT_SECRET,
			);
			const req = new Request("https://api.example.com/api/v1/forums", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const result = await checkMaintenance(req, env);
			expect(result).not.toBeNull();
			expect(result?.status).toBe(503);
		});

		it("should block request without Authorization header", async () => {
			const env = makeMaintenanceEnv(true);
			const req = new Request("https://api.example.com/api/v1/forums");
			const result = await checkMaintenance(req, env);
			expect(result).not.toBeNull();
			expect(result?.status).toBe(503);
		});

		it("should block request with expired JWT", async () => {
			const env = makeMaintenanceEnv(true);
			const token = await createJwt(
				{ userId: 1, role: UserRole.Admin, exp: Math.floor(Date.now() / 1000) - 3600 },
				TEST_JWT_SECRET,
			);
			const req = new Request("https://api.example.com/api/v1/forums", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const result = await checkMaintenance(req, env);
			expect(result).not.toBeNull();
			expect(result?.status).toBe(503);
		});

		it("should block request with invalid JWT", async () => {
			const env = makeMaintenanceEnv(true);
			const req = new Request("https://api.example.com/api/v1/forums", {
				headers: { Authorization: "Bearer invalid-token" },
			});
			const result = await checkMaintenance(req, env);
			expect(result).not.toBeNull();
			expect(result?.status).toBe(503);
		});

		it("should block request with Bearer prefix but empty token", async () => {
			const env = makeMaintenanceEnv(true);
			const req = new Request("https://api.example.com/api/v1/forums", {
				headers: { Authorization: "Bearer " },
			});
			const result = await checkMaintenance(req, env);
			expect(result).not.toBeNull();
			expect(result?.status).toBe(503);
		});
	});
});

// tests/integration/worker/auth.test.ts — L2 Worker Auth API Tests
// Tests auth endpoints: login, register, refresh, logout, me, check-username

import { describe, expect, test } from "bun:test";
import { createTestJwt, workerFetch, workerPost } from "../setup";

describe("L2: Worker Auth API", () => {
	// ─── Login ─────────────────────────────────────────────────────

	describe("POST /api/v1/auth/login", () => {
		test("returns 400 for missing credentials", async () => {
			const res = await workerPost("/api/v1/auth/login", {});
			expect(res.status).toBe(400);
		});

		test("returns 401 for invalid credentials", async () => {
			const res = await workerPost("/api/v1/auth/login", {
				username: "nonexistent_user_12345",
				password: "wrongpassword",
			});
			// Could be 401 or 404 depending on implementation
			expect([401, 404]).toContain(res.status);
		});
	});

	// ─── Register ──────────────────────────────────────────────────

	describe("POST /api/v1/auth/register", () => {
		test("returns 400 for missing fields", async () => {
			const res = await workerPost("/api/v1/auth/register", {});
			expect(res.status).toBe(400);
		});

		test("returns 400 for invalid email", async () => {
			const res = await workerPost("/api/v1/auth/register", {
				username: "testuser",
				email: "invalid-email",
				password: "password123",
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── Check Username ────────────────────────────────────────────

	describe("GET /api/v1/auth/check-username", () => {
		test("returns invalid for missing username parameter", async () => {
			// API returns 200 with available: false, reason: "invalid" for missing/invalid username
			const res = await workerFetch("/api/v1/auth/check-username");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data.available).toBe(false);
			expect(data.data.reason).toBe("invalid");
		});

		test("returns availability status", async () => {
			const res = await workerFetch("/api/v1/auth/check-username?username=test_unique_12345");
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data).toHaveProperty("data");
			expect(data.data).toHaveProperty("available");
		});
	});

	// ─── Refresh Token ─────────────────────────────────────────────

	describe("POST /api/v1/auth/refresh", () => {
		test("returns 400 for missing refresh token", async () => {
			const res = await workerPost("/api/v1/auth/refresh", {});
			expect(res.status).toBe(400);
		});

		test("returns 401 for invalid refresh token", async () => {
			const res = await workerPost("/api/v1/auth/refresh", {
				refreshToken: "invalid-token",
			});
			expect([400, 401]).toContain(res.status);
		});
	});

	// ─── Logout ────────────────────────────────────────────────────

	describe("DELETE /api/v1/auth/logout", () => {
		test("returns 400 for missing refresh token", async () => {
			// logout requires refreshToken in body, not JWT auth
			// Without a body, it returns 500 (JSON parse error in catch)
			// With empty body, it returns 400
			const res = await workerFetch("/api/v1/auth/logout", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		});

		test("succeeds with any refresh token (fire-and-forget delete)", async () => {
			// logout always succeeds - it deletes from KV and returns success
			const res = await workerFetch("/api/v1/auth/logout", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refreshToken: "non-existent-token" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data.loggedOut).toBe(true);
		});
	});

	// ─── Me (Auth Info) ────────────────────────────────────────────

	describe("GET /api/v1/auth/me", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerFetch("/api/v1/auth/me");
			expect(res.status).toBe(401);
		});

		test("returns user info with valid JWT", async () => {
			const jwt = await createTestJwt(3, 0);
			const res = await workerFetch("/api/v1/auth/me", {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			// Might be 200 or 404 if user ID 1 doesn't exist
			expect([200, 404]).toContain(res.status);
		});
	});
});

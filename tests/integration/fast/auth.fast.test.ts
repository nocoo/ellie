/**
 * tests/integration/fast/auth.fast.test.ts — auth endpoint 4xx edges.
 *
 * Mirrors tests/integration/worker/auth.test.ts using the in-process
 * Worker. Covers credential validation, missing fields, and the JWT
 * gate on /api/v1/auth/me.
 */

import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { createTestEnv, workerFetch } from "./_helpers/env";

const post = (env: { API_KEY: string }, path: string, body: unknown) =>
	workerFetch(env, path, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-API-Key": env.API_KEY },
		body: JSON.stringify(body),
	});

describe("L2-fast: POST /api/v1/auth/login", () => {
	test("returns 400 for missing credentials", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/login", {});
		expect(res.status).toBe(400);
	});

	test("returns 4xx for invalid credentials", async () => {
		// 401 (auth fail), 404 (user not found), or 400 (validation) all valid;
		// what matters is "no auth ever issued from an empty DB".
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/login", {
			username: "nonexistent_user_12345",
			password: "wrongpassword",
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});
});

describe("L2-fast: POST /api/v1/auth/register", () => {
	test("returns 400 for missing fields", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/register", {});
		expect(res.status).toBe(400);
	});

	test("returns 400 for invalid email", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/register", {
			username: "testuser",
			email: "invalid-email",
			password: "password123",
		});
		expect(res.status).toBe(400);
	});
});

describe("L2-fast: GET /api/v1/auth/check-username", () => {
	test("missing username param → 200 with available=false reason=invalid", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/auth/check-username", {
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data?: { available?: boolean; reason?: string } };
		expect(data.data?.available).toBe(false);
		expect(data.data?.reason).toBe("invalid");
	});
});

describe("L2-fast: POST /api/v1/auth/refresh", () => {
	test("missing refresh token → 400", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/refresh", {});
		expect(res.status).toBe(400);
	});

	test("invalid refresh token → 400 or 401", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/refresh", { refreshToken: "invalid-token" });
		expect([400, 401]).toContain(res.status);
	});
});

describe("L2-fast: GET /api/v1/auth/me", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/auth/me", {
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(401);
	});
});

/**
 * tests/integration/fast/user-content.fast.test.ts — JWT-gated write endpoints,
 * 401 / 400 edges without fixtures.
 */

import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { createTestEnv, workerFetch } from "./_helpers/env";

const json = (env: { API_KEY: string }, method: string, path: string, body: unknown) =>
	workerFetch(env, path, {
		method,
		headers: { "Content-Type": "application/json", "X-API-Key": env.API_KEY },
		body: JSON.stringify(body),
	});

describe("L2-fast: POST /api/v1/threads", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await json(env, "POST", "/api/v1/threads", {
			forumId: 1,
			title: "x",
			content: "y",
		});
		expect(res.status).toBe(401);
	});
});

describe("L2-fast: POST /api/v1/posts", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await json(env, "POST", "/api/v1/posts", {
			threadId: 1,
			content: "hi",
		});
		expect(res.status).toBe(401);
	});
});

describe("L2-fast: PATCH /api/v1/users/me", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await json(env, "PATCH", "/api/v1/users/me", { displayName: "x" });
		expect(res.status).toBe(401);
	});
});

describe("L2-fast: POST /api/v1/users/me/password", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await json(env, "POST", "/api/v1/users/me/password", {
			oldPassword: "x",
			newPassword: "y",
		});
		expect(res.status).toBe(401);
	});
});

describe("L2-fast: DELETE /api/v1/me/posts/:id", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/me/posts/1", {
			method: "DELETE",
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(401);
	});
});

describe("L2-fast: DELETE /api/v1/me/threads/:id", () => {
	test("missing JWT → 401", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/me/threads/1", {
			method: "DELETE",
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(401);
	});
});

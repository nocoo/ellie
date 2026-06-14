/**
 * tests/integration/fast/messaging.fast.test.ts — JWT-gated messaging
 * endpoint 401 edges. Empty-DB 4xx mirror without fixtures.
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

describe("L2-fast: messaging — JWT gate", () => {
	test("GET /api/v1/messages without JWT → 401", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/messages", {
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(401);
	});

	test("GET /api/v1/messages/unread-count without JWT → 401", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/messages/unread-count", {
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(401);
	});

	test("POST /api/v1/messages/mark-all-read without JWT → 401", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/messages/mark-all-read", {});
		expect(res.status).toBe(401);
	});

	test("GET /api/v1/messages/:id without JWT → 401", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/messages/1", {
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(res.status).toBe(401);
	});

	test("POST /api/v1/messages without JWT → 401", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/messages", {
			recipientId: 2,
			subject: "Test",
			content: "Hello",
		});
		expect(res.status).toBe(401);
	});
});

/**
 * tests/integration/fast/public.fast.test.ts — read-side public endpoints,
 * 4xx edge cases that don't need fixtures.
 *
 * Mirrors the corresponding paths in tests/integration/http/public.test.ts
 * but runs in-process (no wrangler). Covers the API gate's pass-through
 * for /api/v1/* + the handlers' 404/400 emission shape on missing rows.
 */

import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { createTestEnv, workerFetch } from "./_helpers/env";

const headers = (env: { API_KEY: string }) => ({ "X-API-Key": env.API_KEY });

describe("L2-fast: public reads — 4xx edges", () => {
	test("GET /api/v1/forums returns 200 [] on empty DB", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/forums", { headers: headers(env) });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { forums?: unknown[] } | unknown[];
		// handler may shape as {forums: []} or [] depending on path
		const forums = Array.isArray(body) ? body : (body.forums ?? []);
		expect(Array.isArray(forums)).toBe(true);
		expect(forums.length).toBe(0);
	});

	test("GET /api/v1/forums/:id 404 for non-existent forum", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/forums/999999", { headers: headers(env) });
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/forums/:id/ancestors 404 for non-existent forum", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/forums/999999/ancestors", {
			headers: headers(env),
		});
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/forums/:id/recommended-threads 404 for non-existent forum", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/forums/999999/recommended-threads", {
			headers: headers(env),
		});
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/threads requires forumId parameter (400)", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/threads", { headers: headers(env) });
		expect(res.status).toBe(400);
	});

	test("GET /api/v1/threads/:id 404 for non-existent thread", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/threads/999999", { headers: headers(env) });
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/posts/:id 404 for non-existent post", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/posts/999999", { headers: headers(env) });
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/users/:id 404 for non-existent user", async () => {
		const env = createTestEnv();
		const res = await workerFetch(env, "/api/v1/users/999999", { headers: headers(env) });
		expect(res.status).toBe(404);
	});
});

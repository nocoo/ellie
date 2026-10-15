import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { createTestEnv, workerFetch } from "./_helpers/env";

const post = (env: { API_KEY: string }, path: string, body: unknown) =>
	workerFetch(env, path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-API-Key": env.API_KEY,
			"CF-Connecting-IP": "9.9.9.9",
		},
		body: JSON.stringify(body),
	});

describe("L2-fast: POST /api/v1/cap/challenge", () => {
	test("issues a challenge with Key A", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/cap/challenge", {});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token?: string; challenge?: { c: number } };
		expect(typeof body.token).toBe("string");
		expect(body.challenge?.c).toBe(4);
	});
});

describe("L2-fast: POST /api/v1/cap/redeem", () => {
	test("rejects missing solutions", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/cap/redeem", { token: "nope" });
		expect(res.status).toBe(400);
	});
});

describe("L2-fast: POST /api/v1/auth/register captcha", () => {
	test("valid shape without capToken → CAPTCHA_REQUIRED", async () => {
		const env = createTestEnv();
		const res = await post(env, "/api/v1/auth/register", {
			username: "capuser",
			password: "password123",
			email: "cap@example.com",
			profile: { graduateSchool: "校内人士", campus: "四平路校区" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("CAPTCHA_REQUIRED");
	});
});

import "./_helpers/setup";

import { describe, expect, test } from "bun:test";
import { cleanupCapState } from "../../../apps/worker/src/lib/cap";
import { solveFormat1 } from "../setup";
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

	test("concurrent redeem of one challenge succeeds once", async () => {
		const env = createTestEnv();
		const issued = await post(env, "/api/v1/cap/challenge", {});
		expect(issued.status).toBe(200);
		const { token, challenge } = (await issued.json()) as {
			token: string;
			challenge: { c: number; s: number; d: number };
		};
		const solutions = await solveFormat1(token, challenge.c, challenge.s, challenge.d);
		const [first, second] = await Promise.all([
			post(env, "/api/v1/cap/redeem", { token, solutions }),
			post(env, "/api/v1/cap/redeem", { token, solutions }),
		]);
		const statuses = [first.status, second.status].sort();
		expect(statuses).toEqual([200, 400]);
		const winner = first.status === 200 ? first : second;
		const body = (await winner.json()) as { token?: string };
		expect(typeof body.token).toBe("string");
		const rows = env._sqlite
			.query("SELECT COUNT(*) AS n FROM cap_tokens WHERE token = ?")
			.get(body.token) as { n: number };
		expect(rows.n).toBe(1);
	});

	test("cleanup deletes expired tokens and keeps live ones", async () => {
		const env = createTestEnv();
		const now = Date.now();
		env._sqlite.run("INSERT INTO cap_tokens (token, expires_at) VALUES (?, ?)", [
			"stale",
			now - 1000,
		]);
		env._sqlite.run("INSERT INTO cap_tokens (token, expires_at) VALUES (?, ?)", [
			"live",
			now + 60_000,
		]);
		env._sqlite.run("INSERT INTO cap_nonces (signature_hex, expires_at) VALUES (?, ?)", [
			"live-sig",
			now + 60_000,
		]);
		expect(await cleanupCapState(env, now)).toBe(1);
		const tokens = env._sqlite.query("SELECT token FROM cap_tokens ORDER BY token").all() as {
			token: string;
		}[];
		expect(tokens.map((row) => row.token)).toEqual(["live"]);
		const nonces = env._sqlite.query("SELECT signature_hex FROM cap_nonces").all() as {
			signature_hex: string;
		}[];
		expect(nonces.map((row) => row.signature_hex)).toEqual(["live-sig"]);
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

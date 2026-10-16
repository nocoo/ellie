import { describe, expect, test } from "bun:test";
import { solveFormat1, workerPost } from "../setup";

describe("L2: Worker Cap API", () => {
	test("POST /api/v1/cap/challenge returns a challenge", async () => {
		const res = await workerPost("/api/v1/cap/challenge", {});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token?: string; challenge?: { c: number } };
		expect(typeof body.token).toBe("string");
		expect(body.challenge?.c).toBe(4);
	});

	test("POST /api/v1/cap/redeem rejects missing solutions", async () => {
		const res = await workerPost("/api/v1/cap/redeem", { token: "nope" });
		expect(res.status).toBe(400);
	});

	test("POST /api/v1/cap/redeem rejects a replayed challenge", async () => {
		const issued = await workerPost("/api/v1/cap/challenge", {});
		expect(issued.status).toBe(200);
		const { token, challenge } = (await issued.json()) as {
			token: string;
			challenge: { c: number; s: number; d: number };
		};
		const solutions = await solveFormat1(token, challenge.c, challenge.s, challenge.d);
		const first = await workerPost("/api/v1/cap/redeem", { token, solutions });
		expect(first.status).toBe(200);
		const replay = await workerPost("/api/v1/cap/redeem", { token, solutions });
		expect(replay.status).toBe(400);
	});

	test("POST /api/v1/auth/register without capToken is CAPTCHA_REQUIRED", async () => {
		const res = await workerPost("/api/v1/auth/register", {
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

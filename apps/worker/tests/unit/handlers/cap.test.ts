import { createHash } from "node:crypto";
import { generateChallenge } from "capjs-core";
import { describe, expect, it } from "vitest";
import { challenge, redeem } from "../../../src/handlers/cap";
import {
	cleanupCapState,
	consumeCapNonce,
	consumeCapToken,
	readCapToken,
	storeCapToken,
} from "../../../src/lib/cap";
import { requireCapToken } from "../../../src/lib/cap-gate";
import { createMockKV, makeEnv, TEST_CAP_SECRET, TEST_CAP_TOKEN } from "../../helpers";

function fnv1a(str: string): number {
	let hash = 2166136261;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return hash >>> 0;
}

function fnv1aResume(state: number, str: string): number {
	let h = state;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
	}
	return h >>> 0;
}

function prngFromHash(initialHash: number, length: number): string {
	let state = initialHash;
	let result = "";
	while (result.length < length) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		result += state.toString(16).padStart(8, "0");
	}
	return result.substring(0, length);
}

function solveFormat1(token: string, c: number, s: number, d: number): number[] {
	const solutions: number[] = [];
	const tokenFnv = fnv1a(token);
	for (let i = 0; i < c; i++) {
		const saltSeed = fnv1aResume(tokenFnv, String(i + 1));
		const targetSeed = fnv1aResume(saltSeed, "d");
		const salt = prngFromHash(saltSeed, s);
		const target = prngFromHash(targetSeed, d);
		let nonce = 0;
		for (;;) {
			const hash = createHash("sha256")
				.update(salt + String(nonce))
				.digest("hex");
			if (hash.startsWith(target)) {
				solutions.push(nonce);
				break;
			}
			nonce++;
		}
	}
	return solutions;
}

function challengeReq(ip = "1.2.3.4"): Request {
	return new Request("https://example.com/api/v1/cap/challenge", {
		method: "POST",
		headers: { "CF-Connecting-IP": ip },
	});
}

describe("consumeCapToken", () => {
	it("returns unavailable without CAP_SECRET", async () => {
		const env = makeEnv({ CAP_SECRET: undefined });
		expect(await consumeCapToken(env, TEST_CAP_TOKEN)).toBe("unavailable");
	});

	it("returns required for empty token", async () => {
		const env = makeEnv();
		expect(await consumeCapToken(env, "")).toBe("required");
	});

	it("returns invalid for unknown token", async () => {
		const env = makeEnv();
		expect(await consumeCapToken(env, "missing")).toBe("invalid");
	});

	it("consumes a stored token once", async () => {
		const env = makeEnv();
		expect(await consumeCapToken(env, TEST_CAP_TOKEN)).toBe("ok");
		expect(await consumeCapToken(env, TEST_CAP_TOKEN)).toBe("invalid");
	});

	it("reads capToken from objects only", () => {
		expect(readCapToken(null)).toBe("");
		expect(readCapToken({ capToken: " abc " })).toBe("abc");
		expect(readCapToken({ capToken: 1 })).toBe("");
	});

	it("rejects a replayed nonce", async () => {
		const env = makeEnv();
		expect(await consumeCapNonce(env, "sig", 1000)).toBe(true);
		expect(await consumeCapNonce(env, "sig", 1000)).toBe(false);
	});

	it("consumes a token only once under concurrent calls", async () => {
		const env = makeEnv();
		const results = await Promise.all([
			consumeCapToken(env, TEST_CAP_TOKEN),
			consumeCapToken(env, TEST_CAP_TOKEN),
		]);
		expect(results.sort()).toEqual(["invalid", "ok"]);
	});

	it("treats an empty CAP_SECRET as unavailable", async () => {
		const env = makeEnv({ CAP_SECRET: "" });
		expect(await consumeCapToken(env, TEST_CAP_TOKEN)).toBe("unavailable");
	});

	it("rejects an expired stored token", async () => {
		const env = makeEnv();
		await storeCapToken(env, "stale", Date.now() - 1000);
		expect(await consumeCapToken(env, "stale")).toBe("invalid");
	});

	it("deletes expired rows and keeps live nonces", async () => {
		const env = makeEnv();
		await storeCapToken(env, "stale", Date.now() - 1000);
		expect(await consumeCapNonce(env, "live-sig", 60_000)).toBe(true);
		expect(await cleanupCapState(env)).toBeGreaterThan(0);
		expect(await consumeCapToken(env, "stale")).toBe("invalid");
		expect(await consumeCapNonce(env, "live-sig", 60_000)).toBe(false);
	});
});

describe("requireCapToken", () => {
	it("maps consume results to HTTP errors", async () => {
		const env = makeEnv({ CAP_SECRET: undefined });
		const unavailable = await requireCapToken(env, "x");
		expect(unavailable?.status).toBe(503);

		const required = await requireCapToken(makeEnv(), "");
		expect(required?.status).toBe(400);

		const invalid = await requireCapToken(makeEnv(), "missing");
		expect(invalid?.status).toBe(403);

		expect(await requireCapToken(makeEnv(), TEST_CAP_TOKEN)).toBeNull();
	});
});

describe("POST /api/v1/cap/challenge", () => {
	it("returns 503 without CAP_SECRET", async () => {
		const env = makeEnv({ CAP_SECRET: undefined });
		const res = await challenge(
			new Request("https://example.com/api/v1/cap/challenge", {
				method: "POST",
				headers: { "CF-Connecting-IP": "1.2.3.4" },
			}),
			env,
		);
		expect(res.status).toBe(503);
	});

	it("rejects a missing client IP", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const res = await challenge(
			new Request("https://example.com/api/v1/cap/challenge", { method: "POST" }),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("rate-limits challenge issuance per IP", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		let last = 200;
		for (let i = 0; i < 31; i++) {
			last = (await challenge(challengeReq(), env)).status;
		}
		expect(last).toBe(429);
	});

	it("issues a format-1 challenge", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const res = await challenge(challengeReq(), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			challenge: { c: number; s: number; d: number };
			token: string;
		};
		expect(body.challenge.c).toBe(4);
		expect(body.token.length).toBeGreaterThan(10);
	});

	it("issues production difficulty outside the test lane", async () => {
		const env = makeEnv({
			CAP_SECRET: TEST_CAP_SECRET,
			ENVIRONMENT: "production",
			KV: createMockKV(),
		});
		const res = await challenge(challengeReq(), env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { challenge: { c: number; d: number } };
		expect(body.challenge.c).toBe(20);
		expect(body.challenge.d).toBe(4);
	});
});

describe("POST /api/v1/cap/redeem", () => {
	it("returns 503 without CAP_SECRET", async () => {
		const env = makeEnv({ CAP_SECRET: undefined });
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			}),
			env,
		);
		expect(res.status).toBe(503);
	});

	it("rejects invalid JSON", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{",
			}),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("rejects a body without token or solutions", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { success: boolean; error: string };
		expect(body.success).toBe(false);
		expect(body.error).toBe("invalid_body");
	});

	it("redeems a solved challenge once", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const issued = await challenge(challengeReq(), env);
		const { token, challenge: spec } = (await issued.json()) as {
			token: string;
			challenge: { c: number; s: number; d: number };
		};
		const solutions = solveFormat1(token, spec.c, spec.s, spec.d);
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, solutions }),
			}),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { success: boolean; token: string };
		expect(body.success).toBe(true);
		const replay = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, solutions }),
			}),
			env,
		);
		expect(replay.status).toBe(400);
		expect(await consumeCapToken(env, body.token)).toBe("ok");
		expect(await consumeCapToken(env, body.token)).toBe("invalid");
	});

	it("rejects a challenge signed with a different secret", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const issued = await generateChallenge("other-cap-secret-16", {
			challengeCount: 4,
			challengeDifficulty: 2,
			expiresMs: 60_000,
			scope: "ellie",
		});
		const solutions = solveFormat1(
			issued.token,
			issued.challenge.c,
			issued.challenge.s,
			issued.challenge.d,
		);
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: issued.token, solutions }),
			}),
			env,
		);
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({
			success: false,
			error: "invalid_token",
		});
	});

	it("rejects a challenge issued for another scope", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const issued = await generateChallenge(TEST_CAP_SECRET, {
			challengeCount: 4,
			challengeDifficulty: 2,
			expiresMs: 60_000,
			scope: "other",
		});
		const solutions = solveFormat1(
			issued.token,
			issued.challenge.c,
			issued.challenge.s,
			issued.challenge.d,
		);
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: issued.token, solutions }),
			}),
			env,
		);
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toEqual({
			success: false,
			error: "scope_mismatch",
		});
	});

	it("rejects invalid solutions", async () => {
		const env = makeEnv({ CAP_SECRET: TEST_CAP_SECRET, KV: createMockKV() });
		const issued = await challenge(
			new Request("https://example.com/api/v1/cap/challenge", {
				method: "POST",
				headers: { "CF-Connecting-IP": "1.2.3.4" },
			}),
			env,
		);
		const { token, challenge: spec } = (await issued.json()) as {
			token: string;
			challenge: { c: number };
		};
		const res = await redeem(
			new Request("https://example.com/api/v1/cap/redeem", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, solutions: Array.from({ length: spec.c }, () => 0) }),
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { success: boolean };
		expect(body.success).toBe(false);
	});
});

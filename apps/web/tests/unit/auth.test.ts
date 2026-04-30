import type { Account, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
	default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({
	default: vi.fn(),
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

import {
	decodeJwtExp,
	jwtCallback,
	refreshWorkerToken,
	sessionCallback,
	signInCallback,
} from "@/auth";

// ---------------------------------------------------------------------------
// decodeJwtExp
// ---------------------------------------------------------------------------

describe("decodeJwtExp", () => {
	it("extracts exp from a valid JWT string", () => {
		const payload = { sub: "1", exp: 1711900000 };
		const encoded = btoa(JSON.stringify(payload));
		const jwt = `header.${encoded}.signature`;
		expect(decodeJwtExp(jwt)).toBe(1711900000);
	});

	it("handles base64url encoding (-, _ chars)", () => {
		const payload = { sub: "1", exp: 1711900000 };
		// Manually create base64url (replace + with -, / with _)
		const base64 = btoa(JSON.stringify(payload));
		const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_");
		const jwt = `header.${base64url}.signature`;
		expect(decodeJwtExp(jwt)).toBe(1711900000);
	});

	it("returns 0 for null", () => {
		expect(decodeJwtExp(null)).toBe(0);
	});

	it("returns 0 for undefined", () => {
		expect(decodeJwtExp(undefined)).toBe(0);
	});

	it("returns 0 for empty string", () => {
		expect(decodeJwtExp("")).toBe(0);
	});

	it("returns 0 for malformed JWT (wrong number of parts)", () => {
		expect(decodeJwtExp("only.two")).toBe(0);
	});

	it("returns 0 for invalid base64 payload", () => {
		expect(decodeJwtExp("a.!!!invalid!!!.c")).toBe(0);
	});

	it("returns 0 when payload has no exp field", () => {
		const payload = { sub: "1", iat: 100 };
		const encoded = btoa(JSON.stringify(payload));
		expect(decodeJwtExp(`h.${encoded}.s`)).toBe(0);
	});

	it("returns 0 when exp is not a number", () => {
		const payload = { exp: "not-a-number" };
		const encoded = btoa(JSON.stringify(payload));
		expect(decodeJwtExp(`h.${encoded}.s`)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Helper: build a mock JWT token string with a given exp
// ---------------------------------------------------------------------------

function makeJwtString(exp: number): string {
	const payload = btoa(JSON.stringify({ sub: "1", exp }));
	return `header.${payload}.signature`;
}

// ---------------------------------------------------------------------------
// jwtCallback
// ---------------------------------------------------------------------------

describe("jwtCallback", () => {
	it("Credentials first login: stores workerJwt, refreshToken, exp, role, provider", () => {
		const token: JWT = {};
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const jwtString = makeJwtString(exp);
		const user: User = {
			id: "42",
			name: "forumuser",
			workerJwt: jwtString,
			workerRefreshToken: "refresh-abc",
			role: 0,
		};
		const account = { provider: "credentials" } as Account;

		const result = jwtCallback({ token, user, account });
		expect(result).toEqual({
			provider: "credentials",
			sub: "42",
			name: "forumuser",
			workerJwt: jwtString,
			workerRefreshToken: "refresh-abc",
			workerJwtExp: exp,
			role: 0,
			error: undefined,
		});
	});

	it("Credentials first login with banned user: returns token without storing jwt", () => {
		const token: JWT = { sub: "old" };
		const user: User = {
			id: "banned",
			name: "",
			banned: true,
		};
		const account = { provider: "credentials" } as Account;

		const result = jwtCallback({ token, user, account });
		expect(result).toEqual({ sub: "old" }); // Unchanged
	});

	it("Subsequent request with valid (non-expiring) workerJwtExp: returns token unchanged", () => {
		const farFuture = Math.floor(Date.now() / 1000) + 86400; // 24h from now
		const token: JWT = {
			provider: "credentials",
			workerJwt: "some-jwt",
			workerRefreshToken: "some-refresh",
			workerJwtExp: farFuture,
			role: 0,
		};

		const result = jwtCallback({ token });
		expect(result).toEqual(token);
	});

	it("Token already in error state: does not attempt refresh again", () => {
		const expiredTime = Math.floor(Date.now() / 1000) - 100;
		const token: JWT = {
			provider: "credentials",
			workerJwt: "old-jwt",
			workerRefreshToken: "old-refresh",
			workerJwtExp: expiredTime,
			error: "RefreshTokenExpired",
		};

		const result = jwtCallback({ token });
		// Should return immediately without attempting refresh
		expect(result).toEqual(token);
	});

	it("Subsequent request with near-expiry: calls refresh (async)", async () => {
		// Token expires in 2 minutes (within 5-min buffer)
		const nearExpiry = Math.floor(Date.now() / 1000) + 120;
		const token: JWT = {
			provider: "credentials",
			workerJwt: "old-jwt",
			workerRefreshToken: "old-refresh",
			workerJwtExp: nearExpiry,
			role: 0,
		};

		// jwtCallback returns a Promise when refresh is needed
		const result = jwtCallback({ token });
		expect(result).toBeInstanceOf(Promise);

		// The actual refresh will fail (no mock fetch) -> should set error
		const resolved = await result;
		expect((resolved as JWT).error).toBe("RefreshTokenExpired");
	});

	it("No workerJwtExp on credentials token: returns token unchanged", () => {
		const token: JWT = {
			provider: "credentials",
			workerJwt: "some-jwt",
			workerRefreshToken: "some-refresh",
			// workerJwtExp intentionally omitted (0 / undefined)
		};

		const result = jwtCallback({ token });
		expect(result).toEqual(token);
	});
});

// ---------------------------------------------------------------------------
// sessionCallback
// ---------------------------------------------------------------------------

describe("sessionCallback", () => {
	it("Credentials provider: exposes id, name, provider, role -- no workerJwt", () => {
		const session = { user: {} } as unknown as Session;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			name: "forumuser",
			role: 0,
			workerJwt: "should-not-appear",
		};

		const result = sessionCallback({ session, token });
		expect(result.user).toEqual({
			id: "42",
			name: "forumuser",
			provider: "credentials",
			role: 0,
		});
		// workerJwt must NOT leak to session
		expect((result.user as Record<string, unknown>).workerJwt).toBeUndefined();
	});

	it("Credentials provider with error: sets session.error", () => {
		const session = { user: {} } as unknown as Session;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			name: "forumuser",
			role: 0,
			error: "RefreshTokenExpired",
		};

		const result = sessionCallback({ session, token });
		expect(result.error).toBe("RefreshTokenExpired");
	});

	it("Credentials provider without error: session.error is undefined", () => {
		const session = { user: {} } as unknown as Session;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			name: "forumuser",
			role: 0,
		};

		const result = sessionCallback({ session, token });
		expect(result.error).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// signInCallback
// ---------------------------------------------------------------------------

describe("signInCallback", () => {
	it("Credentials + banned user: returns false", () => {
		const user = { id: "banned", name: "", banned: true } as User;
		const account = { provider: "credentials" } as Account;

		expect(signInCallback({ user, account })).toBe(false);
	});

	it("Credentials + normal user: returns true", () => {
		const user = { id: "42", name: "forumuser" } as User;
		const account = { provider: "credentials" } as Account;

		expect(signInCallback({ user, account })).toBe(true);
	});

	it("Null account: returns true", () => {
		const user = { id: "42", name: "user" } as User;
		expect(signInCallback({ user })).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// refreshWorkerToken
// ---------------------------------------------------------------------------

describe("refreshWorkerToken", () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env.WORKER_API_URL = "https://worker.example.com";
		process.env.FORUM_API_KEY = "test-api-key";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
		process.env.FORUM_API_KEY = originalEnv.FORUM_API_KEY;
	});

	it("returns null for null refreshToken", async () => {
		expect(await refreshWorkerToken(null)).toBeNull();
	});

	it("returns null for undefined refreshToken", async () => {
		expect(await refreshWorkerToken(undefined)).toBeNull();
	});

	it("returns null for empty string refreshToken", async () => {
		expect(await refreshWorkerToken("")).toBeNull();
	});

	it("returns null when WORKER_API_URL is not set", async () => {
		process.env.WORKER_API_URL = "";
		expect(await refreshWorkerToken("some-token")).toBeNull();
	});

	it("returns null when FORUM_API_KEY is not set", async () => {
		process.env.FORUM_API_KEY = "";
		expect(await refreshWorkerToken("some-token")).toBeNull();
	});

	it("returns new token pair on successful refresh", async () => {
		const mockFetch = vi.fn(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: { token: "new-jwt", refreshToken: "new-refresh" },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		);
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const result = await refreshWorkerToken("old-refresh-token");

		expect(result).toEqual({ token: "new-jwt", refreshToken: "new-refresh" });
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Verify request shape
		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/v1/auth/refresh");
		expect(options.method).toBe("POST");
		expect(options.headers).toEqual({
			"Content-Type": "application/json",
			"X-API-Key": "test-api-key",
		});
		expect(JSON.parse(options.body as string)).toEqual({ refreshToken: "old-refresh-token" });
	});

	it("returns null when Worker responds with non-200", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(new Response("{}", { status: 401 })),
		) as typeof globalThis.fetch;

		expect(await refreshWorkerToken("bad-token")).toBeNull();
	});

	it("returns null when response body lacks data.token", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { refreshToken: "new-r" } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		) as typeof globalThis.fetch;

		expect(await refreshWorkerToken("some-token")).toBeNull();
	});

	it("returns null when response body lacks data.refreshToken", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { token: "new-jwt" } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		) as typeof globalThis.fetch;

		expect(await refreshWorkerToken("some-token")).toBeNull();
	});

	it("returns null when response body has no data field", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: "something" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		) as typeof globalThis.fetch;

		expect(await refreshWorkerToken("some-token")).toBeNull();
	});

	it("returns null on network error (fetch throws)", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.reject(new Error("Network error")),
		) as typeof globalThis.fetch;

		expect(await refreshWorkerToken("some-token")).toBeNull();
	});

	it("strips trailing slashes from WORKER_API_URL", async () => {
		process.env.WORKER_API_URL = "https://worker.example.com///";
		const mockFetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { token: "t", refreshToken: "r" } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		await refreshWorkerToken("tok");
		const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/v1/auth/refresh");
	});
});

// ---------------------------------------------------------------------------
// jwtCallback -- refresh integration (mocked fetch)
// ---------------------------------------------------------------------------

describe("jwtCallback refresh path", () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env.WORKER_API_URL = "https://worker.example.com";
		process.env.FORUM_API_KEY = "test-api-key";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
		process.env.FORUM_API_KEY = originalEnv.FORUM_API_KEY;
	});

	it("successfully refreshes token when within 5-min buffer", async () => {
		const newExp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
		const newJwt = makeJwtString(newExp);

		globalThis.fetch = vi.fn(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: { token: newJwt, refreshToken: "refreshed-rt" },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		) as typeof globalThis.fetch;

		const nearExpiry = Math.floor(Date.now() / 1000) + 120; // 2 minutes
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			name: "user",
			workerJwt: "old-jwt",
			workerRefreshToken: "old-refresh",
			workerJwtExp: nearExpiry,
			role: 0,
		};

		const result = jwtCallback({ token });
		expect(result).toBeInstanceOf(Promise);

		const resolved = (await result) as JWT;
		expect(resolved.workerJwt).toBe(newJwt);
		expect(resolved.workerRefreshToken).toBe("refreshed-rt");
		expect(resolved.workerJwtExp).toBe(newExp);
		expect(resolved.error).toBeUndefined();
	});

	it("sets error when refresh fails (non-200)", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(new Response("{}", { status: 401 })),
		) as typeof globalThis.fetch;

		const nearExpiry = Math.floor(Date.now() / 1000) + 60;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			workerJwt: "old-jwt",
			workerRefreshToken: "old-refresh",
			workerJwtExp: nearExpiry,
			role: 0,
		};

		const result = (await jwtCallback({ token })) as JWT;
		expect(result.error).toBe("RefreshTokenExpired");
		// Original fields preserved (minus error)
		expect(result.workerJwt).toBe("old-jwt");
		expect(result.workerRefreshToken).toBe("old-refresh");
	});

	it("sets error when refresh returns incomplete data", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { token: "new-jwt" } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		) as typeof globalThis.fetch;

		const nearExpiry = Math.floor(Date.now() / 1000) + 60;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			workerJwt: "old-jwt",
			workerRefreshToken: "old-refresh",
			workerJwtExp: nearExpiry,
			role: 0,
		};

		const result = (await jwtCallback({ token })) as JWT;
		expect(result.error).toBe("RefreshTokenExpired");
	});

	it("sets error when network fails during refresh", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.reject(new Error("Network error")),
		) as typeof globalThis.fetch;

		const nearExpiry = Math.floor(Date.now() / 1000) + 60;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			workerJwt: "old-jwt",
			workerRefreshToken: "old-refresh",
			workerJwtExp: nearExpiry,
			role: 0,
		};

		const result = (await jwtCallback({ token })) as JWT;
		expect(result.error).toBe("RefreshTokenExpired");
	});

	it("does not refresh when expiry is beyond buffer (> 5 min)", () => {
		const farFuture = Math.floor(Date.now() / 1000) + 600; // exactly 10 min
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			workerJwt: "valid-jwt",
			workerRefreshToken: "valid-refresh",
			workerJwtExp: farFuture,
			role: 0,
		};

		const result = jwtCallback({ token });
		// Synchronous return = no refresh triggered
		expect(result).not.toBeInstanceOf(Promise);
		expect((result as JWT).error).toBeUndefined();
	});

	it("does not refresh when workerRefreshToken is missing", async () => {
		process.env.WORKER_API_URL = "https://worker.example.com";
		process.env.FORUM_API_KEY = "test-key";

		const nearExpiry = Math.floor(Date.now() / 1000) + 60;
		const token: JWT = {
			provider: "credentials",
			sub: "42",
			workerJwt: "old-jwt",
			workerRefreshToken: undefined,
			workerJwtExp: nearExpiry,
			role: 0,
		};

		const result = jwtCallback({ token });
		expect(result).toBeInstanceOf(Promise);

		const resolved = (await result) as JWT;
		// refreshWorkerToken(undefined) returns null -> error state
		expect(resolved.error).toBe("RefreshTokenExpired");
	});

	it("preserves role and sub after successful refresh", async () => {
		const newExp = Math.floor(Date.now() / 1000) + 86400;
		const newJwt = makeJwtString(newExp);

		globalThis.fetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ data: { token: newJwt, refreshToken: "new-rt" } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		) as typeof globalThis.fetch;

		const token: JWT = {
			provider: "credentials",
			sub: "99",
			name: "superuser",
			workerJwt: "old",
			workerRefreshToken: "old-rt",
			workerJwtExp: Math.floor(Date.now() / 1000) + 60,
			role: 2,
		};

		const result = (await jwtCallback({ token })) as JWT;
		expect(result.sub).toBe("99");
		expect(result.name).toBe("superuser");
		expect(result.role).toBe(2);
		expect(result.provider).toBe("credentials");
	});
});

// ---------------------------------------------------------------------------
// jwtCallback -- uncovered branches
// ---------------------------------------------------------------------------

describe("jwtCallback uncovered branches", () => {
	it("Credentials first login with undefined user.name: sets name to undefined", () => {
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const jwtString = makeJwtString(exp);
		const token: JWT = {};
		const user: User = {
			id: "42",
			workerJwt: jwtString,
			workerRefreshToken: "refresh-abc",
			role: 0,
		};
		const account = { provider: "credentials" } as Account;

		const result = jwtCallback({ token, user, account });
		expect((result as JWT).name).toBeUndefined();
		expect((result as JWT).sub).toBe("42");
	});

	it("Credentials first login without account: falls through to expiry check", () => {
		const farFuture = Math.floor(Date.now() / 1000) + 86400;
		const token: JWT = {
			provider: "credentials",
			workerJwt: "jwt",
			workerRefreshToken: "rt",
			workerJwtExp: farFuture,
			role: 0,
		};
		const user: User = { id: "42", name: "user" };

		// No account -> falls through Credentials-first-login branch
		const result = jwtCallback({ token, user, account: undefined });
		expect(result).toEqual(token);
	});

	it("Token with no provider but workerJwtExp: returns unchanged (not credentials)", () => {
		const farFuture = Math.floor(Date.now() / 1000) + 86400;
		const token: JWT = {
			workerJwt: "jwt",
			workerRefreshToken: "rt",
			workerJwtExp: farFuture,
		};

		const result = jwtCallback({ token });
		// provider is undefined, so expiry check branch is not entered
		expect(result).toEqual(token);
	});
});

// ---------------------------------------------------------------------------
// sessionCallback -- uncovered branches
// ---------------------------------------------------------------------------

describe("sessionCallback uncovered branches", () => {
	it("Credentials with missing token fields: defaults to empty strings", () => {
		const session = { user: {} } as unknown as Session;
		const token: JWT = {
			provider: "credentials",
			// sub, name, role are all missing
		};

		const result = sessionCallback({ session, token });
		expect(result.user.id).toBe("");
		expect(result.user.name).toBe("");
		expect(result.user.role).toBeUndefined();
	});
});

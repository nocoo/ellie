import { describe, expect, it } from "bun:test";
import type { Account, Profile, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import {
	decodeJwtExp,
	jwtCallback,
	sessionCallback,
	signInCallback,
} from "../../apps/web/src/auth";

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
	it("Google OAuth: sets provider, sub, email, name, picture", () => {
		const token: JWT = {};
		const account = { provider: "google" } as Account;
		const profile: Profile = {
			sub: "google-123",
			email: "admin@example.com",
			name: "Admin User",
			picture: "https://img.example.com/pic.jpg",
		};

		const result = jwtCallback({ token, account, profile });
		expect(result).toEqual({
			sub: "google-123",
			email: "admin@example.com",
			name: "Admin User",
			picture: "https://img.example.com/pic.jpg",
			provider: "google",
		});
	});

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

	it("Non-credentials subsequent request: returns token unchanged", () => {
		const token: JWT = {
			provider: "google",
			sub: "g-123",
			email: "admin@example.com",
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

		// The actual refresh will fail (no mock fetch) → should set error
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
	it("Credentials provider: exposes id, name, provider, role — no workerJwt", () => {
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

	it("Google provider: exposes id, email, name, image, provider", () => {
		const session = { user: { id: "", email: "", name: "", image: "" } } as unknown as Session;
		const token: JWT = {
			provider: "google",
			sub: "g-123",
			email: "admin@example.com",
			name: "Admin",
			picture: "https://img.example.com/pic.jpg",
		};

		const result = sessionCallback({ session, token });
		expect(result.user.id).toBe("g-123");
		expect(result.user.email).toBe("admin@example.com");
		expect(result.user.name).toBe("Admin");
		expect(result.user.image).toBe("https://img.example.com/pic.jpg");
		expect(result.user.provider).toBe("google");
	});

	it("Google provider without existing user fields: still sets provider", () => {
		const session = { user: {} } as unknown as Session;
		const token: JWT = {
			provider: "google",
			sub: "g-456",
		};

		const result = sessionCallback({ session, token });
		expect(result.user.provider).toBe("google");
		expect(result.user.id).toBe("g-456");
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

	it("Google provider: returns true", () => {
		const user = { id: "g-123", name: "Admin" } as User;
		const account = { provider: "google" } as Account;

		expect(signInCallback({ user, account })).toBe(true);
	});

	it("Null account: returns true", () => {
		const user = { id: "42", name: "user" } as User;
		expect(signInCallback({ user })).toBe(true);
	});
});

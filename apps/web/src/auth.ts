/**
 * Auth.js v5 configuration for Ellie.
 *
 * Dual-provider setup:
 * - Google OAuth  → admin console
 * - Credentials   → forum users (username/password → Worker JWT)
 *
 * Ref: docs/04g-user-auth.md §2
 */

import NextAuth from "next-auth";
import type { Account, Profile, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";

// ---------------------------------------------------------------------------
// Environment helpers (only accessed at runtime, server-side)
// ---------------------------------------------------------------------------

function getWorkerUrl(): string {
	return (process.env.WORKER_API_URL ?? "").replace(/\/+$/, "");
}

function getForumApiKey(): string {
	return process.env.FORUM_API_KEY ?? "";
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without next-auth runtime)
// ---------------------------------------------------------------------------

/**
 * Decode JWT payload to extract `exp` claim.
 * No cryptographic verification — we trust the token because we just
 * received it from our own Worker.
 */
export function decodeJwtExp(jwt: string | undefined | null): number {
	if (!jwt) return 0;
	try {
		const parts = jwt.split(".");
		if (parts.length !== 3) return 0;
		// Handle both standard base64 and base64url
		const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const payload = JSON.parse(atob(base64));
		return typeof payload.exp === "number" ? payload.exp : 0;
	} catch {
		return 0;
	}
}

/**
 * Call Worker refresh endpoint. Returns new token pair or null on failure.
 * Server-side only — uses Key A (FORUM_API_KEY).
 */
export async function refreshWorkerToken(
	refreshToken: string | undefined | null,
): Promise<{ token: string; refreshToken: string } | null> {
	if (!refreshToken) return null;

	const workerUrl = getWorkerUrl();
	const apiKey = getForumApiKey();
	if (!workerUrl || !apiKey) return null;

	try {
		const res = await fetch(`${workerUrl}/api/v1/auth/refresh`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": apiKey,
			},
			body: JSON.stringify({ refreshToken }),
		});

		if (!res.ok) return null;

		const body = (await res.json()) as {
			data?: { token?: string; refreshToken?: string };
		};
		if (!body.data?.token || !body.data?.refreshToken) return null;
		return { token: body.data.token, refreshToken: body.data.refreshToken };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Exported callbacks (pure functions, testable in isolation)
// ---------------------------------------------------------------------------

/** JWT callback — handles both Google OAuth and Credentials providers. */
export function jwtCallback({
	token,
	user,
	account,
	profile,
}: {
	token: JWT;
	user?: User;
	account?: Account | null;
	profile?: Profile;
}): JWT | Promise<JWT> {
	// ── Google OAuth (admin) ──
	if (account?.provider === "google") {
		token.sub = profile?.sub ?? undefined;
		token.email = profile?.email ?? undefined;
		token.name = profile?.name ?? undefined;
		token.picture = (profile?.picture as string) ?? undefined;
		token.provider = "google";
		return token;
	}

	// ── Credentials first login ──
	if (account?.provider === "credentials" && user) {
		// Skip banned sentinel (signIn callback will reject)
		if (user.banned) return token;

		token.provider = "credentials";
		token.sub = user.id;
		token.name = user.name ?? undefined;
		token.workerJwt = user.workerJwt;
		token.workerRefreshToken = user.workerRefreshToken;
		token.workerJwtExp = decodeJwtExp(user.workerJwt);
		token.role = user.role;
		token.error = undefined;
		return token;
	}

	// ── Subsequent requests: check Worker JWT expiry ──
	if (token.provider === "credentials" && token.workerJwtExp) {
		// Don't retry if already in error state
		if (token.error === "RefreshTokenExpired") return token;

		const now = Math.floor(Date.now() / 1000);
		const buffer = 5 * 60; // Refresh 5 minutes before expiry
		if (now > token.workerJwtExp - buffer) {
			// Need async refresh — return a promise
			return (async () => {
				const refreshed = await refreshWorkerToken(token.workerRefreshToken);
				if (refreshed) {
					token.workerJwt = refreshed.token;
					token.workerRefreshToken = refreshed.refreshToken;
					token.workerJwtExp = decodeJwtExp(refreshed.token);
					token.error = undefined;
				} else {
					token.error = "RefreshTokenExpired";
				}
				return token;
			})();
		}
	}

	return token;
}

/** Session callback — expose user info to client (no workerJwt). */
export function sessionCallback({
	session,
	token,
}: {
	session: Session;
	token: JWT;
}): Session {
	if (token.provider === "credentials") {
		session.user = {
			id: token.sub ?? "",
			name: token.name ?? "",
			provider: "credentials",
			role: token.role,
		};
		if (token.error) {
			session.error = token.error;
		}
	} else {
		// Google OAuth — preserve existing behavior
		if (session.user) {
			session.user.id = token.sub ?? "";
			session.user.email = token.email ?? "";
			session.user.name = token.name ?? "";
			session.user.image = token.picture as string | undefined;
		}
		session.user.provider = "google";
	}
	return session;
}

/** signIn callback — intercept banned users from Credentials provider. */
export function signInCallback({
	user,
	account,
}: {
	user: User;
	account: Account | null;
}): boolean {
	if (account?.provider === "credentials" && user.banned) {
		return false; // → NextAuth throws AccessDenied
	}
	return true;
}

// ---------------------------------------------------------------------------
// NextAuth configuration — lazy init pattern
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth(async () => ({
	trustHost: true,
	providers: [Google],
	session: {
		strategy: "jwt" as const,
		maxAge: 30 * 24 * 60 * 60, // 30 days — align with refresh token TTL
	},
	callbacks: {
		signIn: signInCallback,
		jwt: jwtCallback,
		session: sessionCallback,
	},
	pages: {
		signIn: "/admin/login",
		error: "/admin/login",
	},
}));

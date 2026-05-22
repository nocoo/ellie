/**
 * Server-side forum auth utilities.
 *
 * - getWorkerJwt(): Decrypt NextAuth cookie → extract Worker JWT
 * - getCurrentForumUser(): Extract user info from cookie
 * - authPatch(): PATCH authenticated Worker API with TOKEN_EXPIRED one-shot retry
 *
 * Uses getToken() from @auth/core/jwt which handles cookie chunking
 * automatically (Auth.js splits JWE into .0, .1, ... when >4KB).
 *
 * Ref: docs/04g-user-auth.md §3
 */

import "server-only";

import { getToken } from "@auth/core/jwt";
import { headers } from "next/headers";

import { type ApiResponse, type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";

function getAuthSecret(): string {
	const secret = process.env.AUTH_SECRET;
	if (!secret) throw new Error("AUTH_SECRET environment variable is not set");
	return secret;
}

/**
 * Decrypt NextAuth session cookie → full JWT payload (incl. workerJwt).
 *
 * getToken() internally:
 * 1. Extracts cookies from request headers
 * 2. Reassembles chunked cookies (.0, .1, ...) via SessionStore
 * 3. Decrypts JWE → returns full JWT payload
 *
 * Does NOT trigger jwt/session callbacks. Does NOT write cookies.
 */
async function getSessionToken() {
	const headerStore = await headers();
	const isSecure =
		process.env.NODE_ENV === "production" || process.env.AUTH_URL?.startsWith("https://");
	const cookiePrefix = isSecure ? "__Secure-" : "";
	return getToken({
		req: { headers: headerStore },
		secret: getAuthSecret(),
		secureCookie: isSecure,
		salt: `${cookiePrefix}authjs.session-token`,
	});
}

/** Get current forum user's Worker JWT, or null. */
export async function getWorkerJwt(): Promise<string | null> {
	const token = await getSessionToken();
	if (!token) return null;
	if (token.provider !== "credentials") return null;
	if (token.error === "RefreshTokenExpired") return null;
	return (token.workerJwt as string) ?? null;
}

/** Get current forum user info, or null. */
export async function getCurrentForumUser(): Promise<{
	userId: number;
	username: string;
	role: number;
} | null> {
	const token = await getSessionToken();
	if (!token || token.provider !== "credentials") return null;
	return {
		userId: Number(token.sub),
		username: (token.name as string) ?? "",
		role: (token.role as number) ?? 0,
	};
}

/** Get current session provider, or null if not logged in */
export async function getSessionProvider(): Promise<string | null> {
	const token = await getSessionToken();
	if (!token) return null;
	return (token.provider as string) ?? null;
}

/**
 * PATCH authenticated Worker API with TOKEN_EXPIRED one-shot retry.
 *
 * When the Worker JWT is expired but the page hasn't been navigated
 * (so proxy hasn't refreshed the cookie yet), this function:
 * 1. Catches TOKEN_EXPIRED from the first attempt
 * 2. Refreshes via Worker /api/v1/auth/refresh
 * 3. Retries with the new JWT
 *
 * ⚠️ Limitation: The refreshed token is NOT written back to the NextAuth
 * cookie (Server Actions can't write cookies). Only the current call
 * succeeds; the next Server Action call on the same stale page will
 * get a new TOKEN_EXPIRED and fail. The user needs to navigate to
 * trigger a proxy refresh.
 *
 * Returns:
 * - ApiResponse<T> on success
 * - { error: "NOT_AUTHENTICATED" } when the session is missing or refresh fails
 *
 * Throws `ForumApiError` for any other Worker error (preserving status,
 * code, message, and rawBody) so proxy callers can run the body through
 * `forumApiErrorToProxyResponse()` and forward flat docs/17 §5.4 payloads
 * verbatim. The previous version collapsed every Worker error into
 * `{ error: code }`, losing status and the EmailNotVerified dialog payload.
 *
 * Ref: docs/04g-user-auth.md §3.3
 */
export async function authPatch<T>(
	path: string,
	body: unknown,
	client?: ClientContext,
): Promise<ApiResponse<T> | { error: "NOT_AUTHENTICATED" }> {
	const token = await getSessionToken();
	if (!token || token.provider !== "credentials") return { error: "NOT_AUTHENTICATED" };
	if (token.error === "RefreshTokenExpired") return { error: "NOT_AUTHENTICATED" };

	const workerJwt = token.workerJwt as string;
	if (!workerJwt) return { error: "NOT_AUTHENTICATED" };

	try {
		return await forumApi.patchAuth<T>(path, body, workerJwt, client);
	} catch (error) {
		if (!(error instanceof ForumApiError) || error.code !== "TOKEN_EXPIRED") {
			throw error;
		}

		// TOKEN_EXPIRED → try refresh once
		const refreshToken = token.workerRefreshToken as string;
		if (!refreshToken) return { error: "NOT_AUTHENTICATED" };

		try {
			const refreshResult = await forumApi.post<{
				token: string;
				refreshToken: string;
			}>("/api/v1/auth/refresh", { refreshToken });

			return await forumApi.patchAuth<T>(path, body, refreshResult.data.token, client);
		} catch {
			return { error: "NOT_AUTHENTICATED" };
		}
	}
}

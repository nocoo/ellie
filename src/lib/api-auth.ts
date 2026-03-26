// lib/api-auth.ts — API route authentication helpers
// Ref: 04b §认证方案 — dual-mode auth for API routes
//
// Resolves authenticated user identity from:
//   1. NextAuth session cookie (browser flow after signIn)
//   2. X-Mock-Uid / X-Mock-Role headers (API testing via curl/Postman)
//
// Use in route handlers that require authentication or role checks.

import { auth } from "@/lib/auth-instance";

/**
 * Get the authenticated user ID from session cookie or X-Mock-Uid header.
 * Returns null if no valid authentication is found.
 */
export async function getAuthUserId(request: Request): Promise<number | null> {
	// 1. Try NextAuth session cookie (browser flow)
	// auth() depends on next/headers which is only available in actual
	// Next.js request context — fails gracefully in unit tests.
	try {
		const session = await auth();
		if (session?.user?.id) {
			return Number(session.user.id);
		}
	} catch {
		// Not in Next.js request context (e.g., unit tests) — fall through to header check
	}

	// 2. Fallback: X-Mock-Uid header (API testing via curl)
	const mockUid = request.headers.get("X-Mock-Uid");
	if (mockUid) {
		return Number(mockUid);
	}

	return null;
}

/**
 * Get the authenticated user's role from session cookie or X-Mock-Role header.
 * Returns null if no valid authentication/role is found.
 *
 * Session stores role in `session.user.role` (set by jwt/session callbacks in auth.ts).
 * Fallback reads `X-Mock-Role` header for curl/Postman testing.
 */
export async function getAuthUserRole(request: Request): Promise<number | null> {
	// 1. Try NextAuth session cookie (browser flow)
	try {
		const session = await auth();
		if (session?.user) {
			const role = (session.user as Record<string, unknown>).role;
			if (role != null) {
				return Number(role);
			}
		}
	} catch {
		// Not in Next.js request context — fall through to header check
	}

	// 2. Fallback: X-Mock-Role header (API testing via curl)
	const roleHeader = request.headers.get("X-Mock-Role");
	if (roleHeader !== null && roleHeader !== "") {
		const role = Number(roleHeader);
		if (!Number.isNaN(role)) return role;
	}

	return null;
}

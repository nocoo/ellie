// lib/api-auth.ts — API route authentication helper
// Ref: 04b §认证方案 — dual-mode auth for API routes
//
// Resolves authenticated user ID from:
//   1. NextAuth session cookie (browser flow after signIn)
//   2. X-Mock-Uid header (API testing via curl/Postman)
//
// Use in POST/PUT/DELETE route handlers that require authentication.

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

/**
 * Admin API proxy helpers.
 *
 * createProxyHandler() is a factory that produces Next.js API Route handlers.
 * Each handler:
 *   1. Validates CSRF origin (non-GET only)
 *   2. Verifies admin session (auth() + resolveAdmin())
 *   3. Forwards the request to the Worker via adminApi
 *   4. Returns the Worker response as-is
 */

import { auth } from "@/auth";
import { type AdminInfo, resolveAdmin } from "@/lib/admin";
import { adminApi } from "@/lib/admin-api";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// CSRF Origin validation
// ---------------------------------------------------------------------------

/**
 * Get the list of allowed origins for CSRF validation.
 * Exported for testing.
 */
export function getAllowedOrigins(): string[] {
	return [process.env.AUTH_URL, "http://localhost:7047", "http://localhost:3000"].filter(
		Boolean,
	) as string[];
}

/**
 * Validate that the request Origin/Referer matches an allowed origin.
 * Only checked for non-GET/HEAD methods.
 * Exported for testing.
 */
export function validateOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin") || request.headers.get("Referer");
	if (!origin) return false;
	return getAllowedOrigins().some((allowed) => origin.startsWith(allowed));
}

// ---------------------------------------------------------------------------
// JSON error helpers
// ---------------------------------------------------------------------------

function jsonError(status: number, code: string, message: string) {
	return NextResponse.json({ error: { code, message } }, { status });
}

// ---------------------------------------------------------------------------
// Route handler types
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<Record<string, string>> };

/**
 * Handler function that receives admin info and produces a Response.
 * This is what each API route provides to createProxyHandler().
 */
type ProxyHandlerFn = (
	request: NextRequest,
	admin: AdminInfo,
	context: RouteContext,
) => Promise<Response>;

/**
 * Next.js App Router handler signature.
 */
type NextRouteHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;

// ---------------------------------------------------------------------------
// createProxyHandler — factory
// ---------------------------------------------------------------------------

/**
 * Create a Next.js API Route handler with admin auth + CSRF protection.
 *
 * Usage:
 * ```ts
 * export const GET = createProxyHandler(async (req, admin) => {
 *   const res = await adminApi.raw("GET", "/api/admin/users");
 *   return passthrough(res);
 * });
 * ```
 */
export function createProxyHandler(handler: ProxyHandlerFn): NextRouteHandler {
	return async (request: NextRequest, context: RouteContext) => {
		// 1. CSRF check for mutating methods
		if (request.method !== "GET" && request.method !== "HEAD") {
			if (!validateOrigin(request)) {
				return jsonError(403, "CSRF_REJECTED", "Origin not allowed");
			}
		}

		// 2. Auth + admin whitelist check
		const session = await auth();
		const admin = resolveAdmin(session);
		if (!admin) {
			return jsonError(401, "UNAUTHORIZED", "Admin authentication required");
		}

		// 3. Delegate to the handler
		return handler(request, admin, context);
	};
}

// ---------------------------------------------------------------------------
// passthrough — forward Worker response to client
// ---------------------------------------------------------------------------

/**
 * Forward a Worker response to the client, preserving status and body.
 * Strips hop-by-hop headers and sets correct content type.
 */
export async function passthrough(workerResponse: Response): Promise<Response> {
	const body = await workerResponse.text();
	return new Response(body, {
		status: workerResponse.status,
		headers: {
			"Content-Type": workerResponse.headers.get("Content-Type") || "application/json",
		},
	});
}

// ---------------------------------------------------------------------------
// Re-export adminApi for convenience
// ---------------------------------------------------------------------------

export { adminApi };

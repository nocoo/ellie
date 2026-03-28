// API Key validation middleware for Cloudflare Worker
// Dual-key routing: Key A (API_KEY) → /api/v1/*, Key B (ADMIN_API_KEY) → /api/admin/*

import type { Env } from "../lib/env";
import { errorResponse } from "./error";

/**
 * Validates the X-API-Key header using dual-key routing.
 *
 * - `/api/v1/*` routes require Key A (`env.API_KEY`)
 * - `/api/admin/*` routes require Key B (`env.ADMIN_API_KEY`)
 * - Cross-key access is rejected (Key A can't access admin, Key B can't access v1)
 *
 * Returns null on success (pass-through), or a 401 Response on failure.
 */
export function validateApiKey(request: Request, env: Env, origin?: string): Response | null {
	const key = request.headers.get("X-API-Key");
	if (!key) {
		return errorResponse("UNAUTHORIZED", 401, undefined, origin);
	}

	const path = new URL(request.url).pathname;

	if (path.startsWith("/api/admin/")) {
		// Admin routes require Key B (ADMIN_API_KEY)
		if (key !== env.ADMIN_API_KEY) {
			return errorResponse("UNAUTHORIZED", 401, undefined, origin);
		}
		return null;
	}

	// All other routes (including /api/v1/*) require Key A (API_KEY)
	if (key !== env.API_KEY) {
		return errorResponse("UNAUTHORIZED", 401, undefined, origin);
	}
	return null;
}

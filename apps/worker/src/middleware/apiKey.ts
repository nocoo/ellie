// API Key validation middleware for Cloudflare Worker
// Dual-key routing: Key A (API_KEY) → /api/v1/*, Key B (ADMIN_API_KEY) → /api/admin/*

import type { Env } from "../lib/env";
import { errorResponse } from "./error";

/**
 * Validates the X-API-Key header using dual-key routing.
 *
 * - `/api/v1/*` routes require Key A (`env.API_KEY`)
 * - `/api/admin/*` routes require Key B (`env.ADMIN_API_KEY`)
 * - Any other path (or a cross-key attempt) is rejected with 401.
 *
 * The allowlist is explicit and fail-closed: paths outside the two prefixes
 * do not fall through to Key A. This prevents a future router/proxy change
 * that exposes a non-prefixed path from silently inheriting Key-A semantics,
 * and matches the CVE-2026-29045-style guidance to avoid path-startsWith
 * default branches that grant the wider permission.
 *
 * Routes that intentionally bypass this gate (e.g. `/api/live`,
 * `/api/internal/analytics/ingest`) must be dispatched before
 * `validateApiKey` is called — they are not whitelisted here.
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
		if (key !== env.ADMIN_API_KEY) {
			return errorResponse("UNAUTHORIZED", 401, undefined, origin);
		}
		return null;
	}

	if (path.startsWith("/api/v1/")) {
		if (key !== env.API_KEY) {
			return errorResponse("UNAUTHORIZED", 401, undefined, origin);
		}
		return null;
	}

	return errorResponse("UNAUTHORIZED", 401, undefined, origin);
}

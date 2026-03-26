// API Key validation middleware for Cloudflare Worker

import type { Env } from "../lib/env";
import { errorResponse } from "./error";

/**
 * Validates the X-API-Key header against env.API_KEY.
 * Returns null on success (pass-through), or a 401 Response on failure.
 */
export function validateApiKey(request: Request, env: Env, origin?: string): Response | null {
	const key = request.headers.get("X-API-Key");
	if (!key || key !== env.API_KEY) {
		return errorResponse("UNAUTHORIZED", 401, undefined, origin);
	}
	return null;
}

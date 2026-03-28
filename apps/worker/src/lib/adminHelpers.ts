// Admin helpers — simplified for Key B-only auth model
// All /api/admin/* routes are authenticated by the Key B check in apiKey middleware.
// No JWT, no user identity — the Worker trusts Key B implicitly.

import type { EntityConfig } from "./crud";
import type { Env } from "./env";

/**
 * Wraps an admin handler. Key B validation is already done at the router level
 * by validateApiKey(). This wrapper exists to maintain the handler factory pattern.
 *
 * Admin handlers receive (request, env) — no user identity is available.
 */
export function withEntityAuth(
	_config: EntityConfig,
	handler: (request: Request, env: Env) => Promise<Response>,
) {
	return async (request: Request, env: Env): Promise<Response> => {
		return handler(request, env);
	};
}

/**
 * Creates a full set of CRUD route handlers for an entity,
 * each wrapped with withEntityAuth (Key B gate at router level).
 */
export function createEntityHandlers(
	config: EntityConfig,
	handlers: Record<string, (request: Request, env: Env) => Promise<Response>>,
): Record<string, (request: Request, env: Env) => Promise<Response>> {
	const wrapped: Record<string, (request: Request, env: Env) => Promise<Response>> = {};
	for (const [name, handler] of Object.entries(handlers)) {
		wrapped[name] = withEntityAuth(config, handler);
	}
	return wrapped;
}

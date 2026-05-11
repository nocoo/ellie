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
/**
 * Admin handler signature.
 *
 * `ctx` is optional so existing CRUD handlers (which don't need it) keep
 * their two-argument shape. New handlers that need to schedule async
 * work (e.g. `flushPendingNow` after a KV bump/delete) accept the third
 * `ExecutionContext` argument and the router passes it through.
 */
export type AdminHandler = (
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
) => Promise<Response>;

export function withEntityAuth(_config: EntityConfig, handler: AdminHandler) {
	return async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		return handler(request, env, ctx);
	};
}

/**
 * Creates a full set of CRUD route handlers for an entity,
 * each wrapped with withEntityAuth (Key B gate at router level).
 */
export function createEntityHandlers(
	config: EntityConfig,
	handlers: Record<string, AdminHandler>,
): Record<string, AdminHandler> {
	const wrapped: Record<string, AdminHandler> = {};
	for (const [name, handler] of Object.entries(handlers)) {
		wrapped[name] = withEntityAuth(config, handler);
	}
	return wrapped;
}

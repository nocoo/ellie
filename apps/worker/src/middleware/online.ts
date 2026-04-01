// Online tracking middleware — records authenticated users as online in KV
import type { Env } from "../lib/env";
import type { AuthUser } from "./auth";

const ONLINE_TTL = 900; // 15 minutes

export interface OnlineUserData {
	uid: number;
	ip: string;
	page: string;
	ts: number;
}

/**
 * Track authenticated user as online in KV.
 * Call after successful auth, uses waitUntil for non-blocking write.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @param ctx - Execution context for waitUntil
 * @param user - Authenticated user
 */
export function trackOnline(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	user: AuthUser,
): void {
	const key = `online:${user.userId}`;
	const data: OnlineUserData = {
		uid: user.userId,
		ip: request.headers.get("CF-Connecting-IP") || "",
		page: new URL(request.url).pathname,
		ts: Math.floor(Date.now() / 1000),
	};

	// Async write, non-blocking
	ctx.waitUntil(env.KV.put(key, JSON.stringify(data), { expirationTtl: ONLINE_TTL }));
}

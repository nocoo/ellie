// Online tracking middleware — records authenticated users as online in KV
import { extractTrustedClientIp } from "../lib/clientIp";
import type { Env } from "../lib/env";
import type { AuthUser } from "./auth";

const ONLINE_TTL = 900; // 15 minutes
const PRESENCE_WRITE_INTERVAL_MS = 300_000;
const lastWrites = new WeakMap<KVNamespace, Map<number, number>>();

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
	let writes = lastWrites.get(env.KV);
	if (!writes) {
		writes = new Map();
		lastWrites.set(env.KV, writes);
	}
	const now = Date.now();
	const previous = writes.get(user.userId);
	if (previous !== undefined && now - previous < PRESENCE_WRITE_INTERVAL_MS) return;
	if (writes.size >= 4096 && !writes.has(user.userId))
		writes.delete(writes.keys().next().value as number);
	writes.set(user.userId, now);
	const key = `online:${user.userId}`;
	// Use the unified trusted-IP extractor so server-to-Worker BFF calls (which
	// arrive without `CF-Connecting-IP` but with `X-Real-IP`) record the real
	// user IP. Empty string is acceptable here: the online tracker is a soft
	// signal, and empty is preferable to a forged value.
	const data: OnlineUserData = {
		uid: user.userId,
		ip: extractTrustedClientIp(request, env) ?? "",
		page: new URL(request.url).pathname,
		ts: Math.floor(Date.now() / 1000),
	};

	// Async write, non-blocking
	ctx.waitUntil(
		env.KV.put(key, JSON.stringify(data), { expirationTtl: ONLINE_TTL }).catch(() => {
			if (writes.get(user.userId) === now) writes.delete(user.userId);
		}),
	);
}

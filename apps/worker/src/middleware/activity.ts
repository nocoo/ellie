// Activity tracking middleware — updates user activity and accumulates online time
import type { Env } from "../lib/env";
import type { AuthUser } from "./auth";

const ACTIVITY_THRESHOLD = 1800; // 30 minutes — gap beyond this is treated as session break
const THROTTLE_SECONDS = 60; // Throttle: max once per minute per user

/**
 * Update user activity and accumulate online time.
 * Call after successful auth, uses waitUntil for non-blocking writes.
 *
 * Logic:
 * - Skip if updated within THROTTLE_SECONDS (via KV throttle key)
 * - Fetch user's last_activity and ol_time from D1
 * - If gap < ACTIVITY_THRESHOLD and gap >= 60s, add floor(gap/60) minutes to ol_time
 * - Update last_activity to now (with optimistic locking to prevent concurrent overwrites)
 *
 * Concurrency safety:
 * - Uses optimistic locking: UPDATE ... WHERE last_activity = <old_value>
 * - If concurrent requests race, only one will match the WHERE clause
 * - KV throttle provides first line of defense (most duplicates filtered)
 *
 * @param env - Worker environment
 * @param ctx - Execution context for waitUntil
 * @param user - Authenticated user
 */
export async function trackActivity(
	env: Env,
	ctx: ExecutionContext,
	user: AuthUser,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const throttleKey = `activity_throttle:${user.userId}`;

	// Throttle check: skip if updated within 1 minute
	const lastUpdate = await env.KV.get(throttleKey);
	if (lastUpdate && now - Number.parseInt(lastUpdate, 10) < THROTTLE_SECONDS) {
		return;
	}

	// Fetch user's current activity data
	const userData = await env.DB.prepare("SELECT last_activity, ol_time FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ last_activity: number; ol_time: number }>();

	if (!userData) return;

	const gap = now - userData.last_activity;

	// Calculate minutes to add:
	// - If gap is within threshold and at least 60 seconds, add floor(gap/60)
	// - Otherwise add 0 (first activity or session break)
	const addMinutes = gap < ACTIVITY_THRESHOLD && gap >= 60 ? Math.floor(gap / 60) : 0;

	// Async writes: throttle marker + user update with optimistic locking
	ctx.waitUntil(
		Promise.all([
			// Set throttle marker (TTL slightly longer than throttle period)
			env.KV.put(throttleKey, String(now), { expirationTtl: 120 }),
			// Update user's last_activity and ol_time — optimistic lock on last_activity
			// If concurrent request already updated, this WHERE won't match (0 rows affected)
			env.DB.prepare(
				"UPDATE users SET last_activity = ?, ol_time = ol_time + ? WHERE id = ? AND last_activity = ?",
			)
				.bind(now, addMinutes, user.userId, userData.last_activity)
				.run(),
		]),
	);
}

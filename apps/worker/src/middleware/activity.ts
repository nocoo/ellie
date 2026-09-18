// Last-activity display signal; never used for authorization or session expiry.
import type { Env } from "../lib/env";
import type { AuthUser } from "./auth";

const INTERVAL_SECONDS = 900;
// ponytail: bounded per-isolate hint; the conditional D1 update handles other isolates.
const lastWrites = new WeakMap<KVNamespace, Map<number, number>>();

export function trackActivity(env: Env, ctx: ExecutionContext, user: AuthUser): void {
	let writes = lastWrites.get(env.KV);
	if (!writes) {
		writes = new Map();
		lastWrites.set(env.KV, writes);
	}
	const now = Math.floor(Date.now() / 1000);
	const previous = writes.get(user.userId);
	if (previous !== undefined && now - previous < INTERVAL_SECONDS) return;
	if (writes.size >= 4096 && !writes.has(user.userId))
		writes.delete(writes.keys().next().value as number);
	writes.set(user.userId, now);
	ctx.waitUntil(
		env.DB.prepare("UPDATE users SET last_activity = ? WHERE id = ? AND last_activity <= ?")
			.bind(now, user.userId, now - INTERVAL_SECONDS)
			.run()
			.then((result) => {
				if (!result.success) throw new Error("Activity update was not confirmed");
			})
			.catch(() => {
				if (writes.get(user.userId) === now) writes.delete(user.userId);
				console.warn("[activity] last activity update failed");
			}),
	);
}

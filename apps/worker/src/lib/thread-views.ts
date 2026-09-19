// Best-effort view aggregation. Later requests (or the existing cron) flush
// completed 60-second windows. No timer assumes the isolate stays alive.
// Isolate eviction can lose unflushed events; this is not durable accounting.
import { CACHE_TTL_SECONDS } from "@ellie/types";
import type { Env } from "./env";

const WINDOW_MS = CACHE_TTL_SECONDS.SHORT * 1000;
const MAX_THREADS = 2048;
interface Window {
	since: number;
	counts: Map<number, number>;
}
const windows = new WeakMap<KVNamespace, Window>();

export async function flushThreadViews(env: Env): Promise<void> {
	const current = windows.get(env.KV);
	if (!current || Date.now() - current.since < WINDOW_MS || !current.counts.size) return;
	// Detach before I/O: another request can collect the next window while
	// this one writes, but cannot flush these same increments a second time.
	windows.set(env.KV, { since: Date.now(), counts: new Map() });
	const entries = [...current.counts];
	for (let start = 0; start < entries.length; start += 25) {
		const batch = entries.slice(start, start + 25);
		try {
			const cases = batch.map(() => "WHEN ? THEN ?").join(" ");
			const ids = batch.map(([id]) => id);
			const result =
				await env.DB.prepare(`UPDATE threads SET views = views + CASE id ${cases} ELSE 0 END
    WHERE id IN (${ids.map(() => "?").join(",")})`)
					.bind(...batch.flat(), ...ids)
					.run();
			if (!result.success) throw new Error("View update failed");
		} catch {
			// Retrying an unknown write outcome could count it twice. The existing
			// best-effort contract drops this batch and logs the failure.

			console.warn("[thread-views] view batch not confirmed", { threads: batch.length });
		}
	}
}

export function scheduleThreadViewIncrement(
	env: Env,
	ctx: ExecutionContext,
	threadId: number,
): void {
	if (!Number.isSafeInteger(threadId) || threadId <= 0) return;
	const current = windows.get(env.KV) ?? { since: Date.now(), counts: new Map<number, number>() };
	windows.set(env.KV, current);
	if (current.counts.has(threadId) || current.counts.size < MAX_THREADS) {
		current.counts.set(threadId, (current.counts.get(threadId) ?? 0) + 1);
	}
	if (Date.now() - current.since >= WINDOW_MS) ctx.waitUntil(flushThreadViews(env));
}

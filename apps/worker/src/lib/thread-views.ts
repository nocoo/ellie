// Thread view counter — increment scheduler
//
// ────────────────────────────────────────────────────────────────
// Why this file exists
// ────────────────────────────────────────────────────────────────
// The thread-detail handler (`GET /api/v1/threads/:id`) must bump
// `threads.views` on every successful fetch. Historically the bump was
// inlined as a `void DB.prepare(...).run()` — fire-and-forget without
// `ctx.waitUntil`. On Cloudflare Workers, any Promise that is not handed
// to `ctx.waitUntil` may be cancelled the moment the response is
// returned, especially on low-traffic isolates with nothing else
// keeping them alive. This was observed in production: brand-new
// threads (e.g. id 1184179) stayed pinned at `views = 0` even after
// being opened, because the bumps were dropped before D1 flushed them.
//
// `scheduleThreadViewIncrement` centralizes the bump so:
//   1. The UPDATE is bound to the Worker lifecycle via `ctx.waitUntil`.
//   2. D1 errors are logged (`console.warn`) instead of being swallowed
//      by the original `void` discard.
//   3. The handler stays a one-liner; the helper is the single
//      replacement point if/when we move to an in-isolate accumulator
//      with batched flush (P1 — see thread `#ellie-阅读数:b55aba36`).
//
// Contract:
//   - Returns `void`. The helper itself owns the `ctx.waitUntil` call.
//     Callers MUST NOT wrap a second `ctx.waitUntil(...)` around it.
//   - Never throws synchronously: the DB call is constructed inside the
//     waitUntil-bound Promise and any rejection is caught by `.catch`.
//   - Safe to call from any code path that already validated the
//     thread is visible to the caller. The helper has no authorization
//     awareness — gate it at the handler level.

import type { Env } from "./env";

/**
 * Schedule a `views = views + 1` UPDATE for the given thread.
 *
 * The UPDATE is registered with `ctx.waitUntil` so the Worker isolate
 * stays alive until D1 has acknowledged the write. Errors are logged
 * via `console.warn` and never propagate to the caller — view bumps
 * are best-effort by design and must never fail the user-visible
 * detail request.
 */
export function scheduleThreadViewIncrement(
	env: Env,
	ctx: ExecutionContext,
	threadId: number,
): void {
	ctx.waitUntil(
		env.DB.prepare("UPDATE threads SET views = views + 1 WHERE id = ?")
			.bind(threadId)
			.run()
			.then(() => undefined)
			.catch((err: unknown) => {
				console.warn("[thread-views] increment failed", { threadId, err });
			}),
	);
}

// Thread-list v2 read-path glue. Sits between `handlers/thread.ts:list` and
// the KV cache layer.
//
// Responsibilities:
//   - Detect whether the current request is page1 (the only cacheable case).
//   - Resolve `thread:list:gen:<forumId>` and `thread:list:gen:all` once.
//   - Drive `cacheGetOrSet` with a shape validator that hard-rejects payloads
//     missing the contract fields.
//   - Return the cached envelope `{items, total, nextCursor, limit}` to the
//     handler, which then re-shapes it into the existing
//     `paginatedResponse` / `jsonListResponse` branches. Response wire shape
//     is preserved BIT FOR BIT — the KV envelope is internal only.
//
// Bucket-independent: the thread-list payload contains no viewer-conditional
// fields (see docs/19 §6 thread:list:v2). Forum-visibility gating happens
// BEFORE we ever look at this cache, via `forum:meta:v2`. If a future thread
// payload introduces any per-viewer field, this cache MUST add a viewer
// dimension and the design doc MUST be updated.
//
// Page1 is defined as: keyset branch with no `?cursor=`, OR offset branch
// with `?page=1`. Deeper pagination passes through to D1 — see docs/19
// §3.3.1.

import type { Thread } from "@ellie/types";
import type { Env } from "../env";
import { getGen } from "./epoch";
import { threadListGenAllKey, threadListGenKey, threadListKey } from "./keys";
import { cacheGetOrSet } from "./wrap";

/**
 * Limit buckets accepted by the thread-list cache. Values outside this set
 * pass through to D1 — caching for arbitrary `?limit=` values would
 * fragment the cache without bounded benefit.
 *
 * Production callers (web default 20; admin/API up to 100) only ever
 * request these three values.
 */
export const THREAD_LIST_LIMIT_BUCKETS = [20, 50, 100] as const;
export type ThreadListLimitBucket = (typeof THREAD_LIST_LIMIT_BUCKETS)[number];

/**
 * TTL for the page1 cache. Short — correctness comes from explicit gen
 * bumps in `lib/cache/invalidate.ts`; TTL is a safety net for missed
 * invalidations, not the primary correctness mechanism (docs/19 §1.3).
 */
export const THREAD_LIST_TTL = 60; // 1min

/**
 * KV envelope written for one page1 cache entry. Keep this MINIMAL —
 * only what `handlers/thread.ts:list` re-uses to build the response.
 *
 * Post-`9d39588`: the page1 loader is unified — keyset (no cursor) and
 * offset (page=1) requests share the SAME cache key, so the loader
 * MUST always populate BOTH `total` and `nextCursor`. Tightening
 * `total` from `number | null` to `number` lets the validator drop any
 * pre-fix payload that still has `total: null` as a cache miss.
 *
 * - `items`: the canonical Thread payload returned to clients (already
 *   bucket-independent and avatar-enriched).
 * - `total`: visible-thread total for this forum (used by the offset
 *   `paginatedResponse`). Always a number.
 * - `nextCursor`: encoded keyset cursor for the next page; `null` when
 *   the page wasn't full (no more rows).
 * - `limit`: echoed back so the response shape can be reconstructed
 *   without a second KV round-trip.
 *
 * Deep-pagination loaders (cursor / page>1) NEVER pass through the
 * cache; they may produce a transient internal payload and are not
 * subject to this contract.
 */
export interface ThreadListPayloadV2 {
	items: Thread[];
	total: number;
	nextCursor: string | null;
	limit: number;
}

/**
 * Shape validator for `ThreadListPayloadV2`. Treats schema drift as a
 * miss (per `cacheGetOrSet` contract). Intentionally strict so an old
 * cache row that lacks one of the four contract fields — including a
 * pre-`9d39588` row with `total: null` — is dropped on read.
 *
 * Item-level check: if items are non-empty, every item must carry
 * `isAuthorFirstThread` (boolean). Pre-stamp payloads that lack this
 * field are treated as stale so the derived column populates on reload
 * instead of silently defaulting to false for the entire TTL window.
 */
export function isThreadListPayload(value: unknown): value is ThreadListPayloadV2 {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Partial<ThreadListPayloadV2>;
	if (!Array.isArray(v.items)) return false;
	if (typeof v.limit !== "number") return false;
	if (typeof v.total !== "number") return false;
	if (v.nextCursor !== null && typeof v.nextCursor !== "string") return false;
	// Reject stale payloads missing isAuthorFirstThread on items
	if (v.items.length > 0) {
		for (const item of v.items) {
			if (typeof item.isAuthorFirstThread !== "boolean") return false;
			// Anonymous masking (migration 0048): a thread missing the
			// `anonymousAuthor` flag predates the masking work — treat as
			// stale so the next read refills with masked values instead of
			// keeping the unmasked author for the rest of the TTL window.
			if (typeof item.anonymousAuthor !== "number") return false;
		}
	}
	return true;
}

/**
 * Returns true when `limit` is one of the three canonical buckets and
 * therefore eligible for caching.
 */
export function isCacheableLimit(limit: number): limit is ThreadListLimitBucket {
	return (THREAD_LIST_LIMIT_BUCKETS as readonly number[]).includes(limit);
}

/**
 * Returns true when this request shape is page1 — the only case the
 * v2 cache covers.
 *
 * Page1 contract:
 *   - keyset branch: `cursor` absent (`page` MAY be absent).
 *   - offset branch: `cursor` absent AND (`page` absent OR `page === "1"`).
 *
 * Anything with a non-empty cursor, or `page > 1`, is deep pagination
 * and falls through to D1. Empty-string cursor is treated as absent
 * (matches the handler's existing `cursorStr ?` truthy check).
 */
export function isPage1(
	cursor: string | null | undefined,
	page: string | null | undefined,
): boolean {
	if (cursor && cursor.length > 0) return false;
	if (page == null || page.length === 0) return true;
	return Number.parseInt(page, 10) === 1;
}

/**
 * Read or load the page1 thread-list cache entry. Caller MUST have
 * already gated on forum visibility via `forum:meta:v2` — visibility
 * is NOT enforced here because the cached payload is bucket-independent.
 *
 * The loader builds the same `{items, total, nextCursor, limit}`
 * envelope from D1; on miss we cache it for `THREAD_LIST_TTL` seconds.
 */
export async function getThreadListPageOneV2(
	env: Env,
	ctx: ExecutionContext,
	forumId: number,
	limitBucket: ThreadListLimitBucket,
	loader: () => Promise<ThreadListPayloadV2>,
): Promise<ThreadListPayloadV2> {
	// Resolve both gens in parallel — independent reads.
	const [forumGen, allGen] = await Promise.all([
		getGen(env, threadListGenKey(forumId)),
		getGen(env, threadListGenAllKey()),
	]);
	const key = threadListKey(forumId, limitBucket, forumGen, allGen);

	return cacheGetOrSet(env, ctx, key, loader, {
		ttl: THREAD_LIST_TTL,
		validator: isThreadListPayload,
		family: "thread:list:v2",
	});
}

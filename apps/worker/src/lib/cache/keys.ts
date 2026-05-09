// Worker KV cache key builders (v2 schema).
//
// Pure functions only — no IO, no env. See docs/19 §2 (key schema) and §4
// (cache key inventory) for the canonical contract. Any change here MUST
// land in docs/19 in the same commit.

export type VisibilityBucket = "anon" | "member" | "staff" | "admin";
export type ViewerBucket = "public" | "staff";
export type PmBox = "inbox" | "sent";

const SCHEMA = "v2";

// ─── Forum domain ──────────────────────────────────────────────────

export function forumTreeKey(bucket: VisibilityBucket, gen: string): string {
	return `forum:tree:${SCHEMA}:${bucket}:g${gen}`;
}

export function forumSummaryKey(bucket: VisibilityBucket, gen: string): string {
	return `forum:summary:${SCHEMA}:${bucket}:g${gen}`;
}

export function forumMetaKey(forumId: number, bucket: VisibilityBucket, gen: string): string {
	return `forum:meta:${SCHEMA}:${forumId}:${bucket}:g${gen}`;
}

// ─── Thread domain ─────────────────────────────────────────────────

/**
 * Thread list cache key. Only `page=1` is cached; deep pagination is no-cache.
 * `limitBucket` collapses limit values to one of the canonical buckets
 * documented in docs/19 §2.5 (`20|50|100`).
 *
 * Bucket-independent: thread-list payload has no viewer-conditional fields
 * (see docs/19 §6 thread:list:v2 row). Forum-visibility gating happens
 * BEFORE cache lookup via `forum:meta:v2`, so the cached payload itself
 * is bucket-independent. If a future thread payload introduces any
 * per-viewer field, this key MUST add a viewer dimension.
 *
 * Two gens are embedded so `admin/statistics/recalc-threads` can blow
 * the entire thread-list cache via `thread:list:gen:all` without
 * scanning every per-forum gen (docs/19 §3.3.1 option (b)).
 */
export function threadListKey(
	forumId: number,
	limitBucket: number,
	forumGen: string,
	allGen: string,
): string {
	return `thread:list:${SCHEMA}:${forumId}:default:${limitBucket}:p1:gf${forumGen}:ga${allGen}`;
}

export function threadMetaKey(threadId: number, bucket: VisibilityBucket, gen: string): string {
	return `thread:meta:${SCHEMA}:${threadId}:${bucket}:g${gen}`;
}

// ─── Post domain ───────────────────────────────────────────────────

export function postListKey(
	threadId: number,
	limitBucket: number,
	bucket: VisibilityBucket,
	gen: string,
): string {
	return `post:list:${SCHEMA}:${threadId}:${limitBucket}:${bucket}:p1:g${gen}`;
}

// ─── Digest domain ─────────────────────────────────────────────────

/**
 * `forumId`/`level`/`year` may be the literal string `"all"` when the filter
 * is omitted; numeric values are stringified by the caller before passing in
 * so the key shape stays stable.
 */
export function digestListKey(
	bucket: VisibilityBucket,
	forumId: number | "all",
	level: number | "all",
	year: number | "all",
	gen: string,
): string {
	return `digest:list:${SCHEMA}:${bucket}:${forumId}:${level}:${year}:p1:g${gen}`;
}

export function digestStatsKey(bucket: VisibilityBucket, gen: string): string {
	return `digest:stats:${SCHEMA}:${bucket}:g${gen}`;
}

export function digestFiltersKey(bucket: VisibilityBucket, gen: string): string {
	return `digest:filters:${SCHEMA}:${bucket}:g${gen}`;
}

// ─── User domain ───────────────────────────────────────────────────

export function userMiniKey(id: number): string {
	return `user:mini:${SCHEMA}:${id}`;
}

export function userPublicKey(id: number, viewerBucket: ViewerBucket): string {
	return `user:public:${SCHEMA}:${id}:${viewerBucket}`;
}

// ─── PM domain ─────────────────────────────────────────────────────

export function pmInboxKey(userId: number, box: PmBox): string {
	return `pm:inbox:${SCHEMA}:${userId}:${box}:p1`;
}

export function pmUnreadKey(userId: number): string {
	return `pm:unread:${SCHEMA}:${userId}`;
}

// ─── Misc domain ───────────────────────────────────────────────────

export function settingsAllKey(): string {
	return `settings:all:${SCHEMA}`;
}

export function statsPublicKey(): string {
	return `stats:public:${SCHEMA}`;
}

// ─── Generation key inventory ──────────────────────────────────────
//
// Generation keys live in their own short namespace. They store an opaque
// token string produced by `bumpGen` (see `epoch.ts`). Pure builders only.

export function forumTreeGenKey(): string {
	return "forum:tree:gen";
}

export function forumSummaryGenKey(): string {
	return "forum:summary:gen";
}

export function threadListGenKey(forumId: number): string {
	return `thread:list:gen:${forumId}`;
}

/**
 * Global thread-list generation. Used as the second component of
 * `threadListKey`; bumping it invalidates EVERY per-forum thread:list:v2
 * key in one write. Reserved for low-frequency admin operations like
 * `recalc-threads` and `purge` fallback where the affected `forumId`
 * set isn't known up-front (docs/19 §3.3.1 option (b)).
 */
export function threadListGenAllKey(): string {
	return "thread:list:gen:all";
}

export function threadMetaGenKey(threadId: number): string {
	return `thread:meta:gen:${threadId}`;
}

export function postListGenKey(threadId: number): string {
	return `post:list:gen:${threadId}`;
}

export function digestGenKey(): string {
	return "digest:gen";
}

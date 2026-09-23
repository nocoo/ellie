// Worker KV cache key builders, including retained legacy key names.
//
// No storage IO or env. See docs/20 §3.2 for the canonical dimensions
// and §4 for the family inventory. Keep that contract in sync with changes.

import type { CacheParams } from "@ellie/types";

export type VisibilityBucket = "anon" | "member" | "staff" | "admin";
export type ViewerBucket = "public" | "staff";
export type PmBox = "inbox" | "sent";

const SCHEMA = "v2";
const hashing = new Map<string, Promise<string>>();

/** Complete canonical dimensions, including audience and captured resource versions. */
export async function dataCacheKey(
	family: string,
	params: CacheParams,
	scope = "public",
	gens: Record<string, string> = {},
): Promise<string> {
	const ordered = (value: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
	const input = JSON.stringify([family, ordered(params), scope, ordered(gens)]);
	const existing = hashing.get(input);
	if (existing) return existing;
	const task = crypto.subtle
		.digest("SHA-256", new TextEncoder().encode(input))
		.then((bytes) => {
			const digest = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(
				"",
			);
			const bypass = Object.values(gens).includes("!unavailable") ? ":!unavailable" : "";
			return `cache:v3:${family}:${digest}${bypass}`;
		})
		.finally(() => {
			hashing.delete(input);
		});
	// Key derivation is shared, never completed business values. The bound
	// also limits memory for a burst of distinct search/cursor parameters.
	if (hashing.size < 1024) hashing.set(input, task);
	return task;
}

export function postEntityGenKey(postId: number): string {
	return `post:entity:gen:${postId}`;
}

export function postAttachmentsGenKey(postId: number): string {
	return `post:attachments:gen:${postId}`;
}

export function recommendedGenKey(forumId: number): string {
	return `recommended:gen:${forumId}`;
}

// ─── Forum domain ──────────────────────────────────────────────────

export function forumTreeKey(bucket: VisibilityBucket, gen: string): string {
	return `forum:tree:${SCHEMA}:${bucket}:g${gen}`;
}

// ─── Thread domain ─────────────────────────────────────────────────

/**
 * Legacy v2 first-page key, retained for recognizing old entries.
 * Live thread-list reads use dataCacheKey through threadListCacheKey;
 * all legal pages, cursors and limits are covered (docs/20 §4).
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

// ─── Generation key inventory ──────────────────────────────────────
//
// Generation keys live in their own short namespace. They store an opaque
// token string produced by `bumpGen` (see `epoch.ts`). Pure builders only.

export function forumTreeGenKey(): string {
	return "forum:tree:gen";
}

export function threadListGenKey(forumId: number): string {
	return `thread:list:gen:${forumId}`;
}

/**
 * Global thread-list generation for global-announcement changes and
 * explicit group invalidation. Known forum changes use their scoped
 * generation instead (docs/20 §5).
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

export function pmUserGenKey(userId: number): string {
	return `pm:user:gen:${userId}`;
}
export function statsReportsGenKey(): string {
	return "stats:reports:gen";
}

export function adminEntityGenKey(resource: string): string {
	return `admin:entity:gen:${resource}`;
}

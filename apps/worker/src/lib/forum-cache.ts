// Forum tree KV cache — read-through cache for forum structural data.
// Caches structural/metadata fields needed for breadcrumbs, visibility checks,
// and tree display. Volatile data (last-post, counts) is NOT cached here.
//
// See notes/ellie-kv-cache-proposal.md for full design.

import type { ForumVisibility, ModeratorInfo } from "@ellie/types";
import type { Env } from "./env";
import { parseModeratorIds } from "./mappers";

// ─── Types ──────────────────────────────────────────────────────────

/** Structural fields cached in KV (no volatile counts/last-post data). */
export interface ForumTreeEntry {
	id: number;
	parentId: number;
	name: string;
	description: string;
	icon: string;
	displayOrder: number;
	status: number;
	visibility: ForumVisibility;
	type: string;
	/** Comma-separated moderator usernames (used by canModerate permission check). */
	moderators: string;
	moderatorIds: string;
	moderatorList: ModeratorInfo[];
}

interface CachedForumTree {
	forums: ForumTreeEntry[];
	cachedAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const FORUM_TREE_KEY = "forums:tree:v1";
/** Safety-net TTL: 10 minutes. Stale visibility could allow unauthorized access. */
const FORUM_TREE_TTL = 600;

// ─── Feature flag ───────────────────────────────────────────────────

export function isForumCacheEnabled(env: Env): boolean {
	return env.USE_KV_FORUM_CACHE === "true";
}

// ─── Validation ────────────────────────────────────────────────────

/** Validate a single cached entry has all fields required by the current schema. */
function isValidEntry(entry: unknown): boolean {
	if (typeof entry !== "object" || entry === null) return false;
	const e = entry as Record<string, unknown>;
	return (
		typeof e.id === "number" &&
		typeof e.parentId === "number" &&
		typeof e.name === "string" &&
		typeof e.status === "number" &&
		typeof e.visibility === "string" &&
		typeof e.type === "string" &&
		typeof e.moderators === "string" &&
		typeof e.moderatorIds === "string" &&
		Array.isArray(e.moderatorList)
	);
}

/** Full shape check for cached payload — rejects corrupt / schema-mismatched data. */
function isValidCachedTree(cached: CachedForumTree): boolean {
	if (!Array.isArray(cached.forums)) return false;
	if (cached.forums.length === 0) return true; // empty tree is valid
	return cached.forums.every(isValidEntry);
}

// ─── Read-through cache ─────────────────────────────────────────────

/**
 * Get the forum tree from KV cache, falling through to D1 on miss.
 * Always returns data (from KV or D1). Never throws on KV failures.
 *
 * @param env Worker environment
 * @param ctx ExecutionContext for non-blocking KV.put on public requests (optional for admin callers)
 */
export async function getForumTree(env: Env, ctx?: ExecutionContext): Promise<ForumTreeEntry[]> {
	// Try KV cache first (only when feature flag is enabled)
	if (isForumCacheEnabled(env)) {
		try {
			const cached = await env.KV.get<CachedForumTree>(FORUM_TREE_KEY, "json");
			if (cached && isValidCachedTree(cached)) {
				return cached.forums;
			}
		} catch {
			// KV read failure — fall through to D1
		}
	}

	// D1 fallback: fetch structural fields + moderator names
	const forumRows = await env.DB.prepare(
		"SELECT id, parent_id, name, description, icon, display_order, status, visibility, type, moderators, moderator_ids FROM forums ORDER BY display_order",
	).all<{
		id: number;
		parent_id: number;
		name: string;
		description: string;
		icon: string;
		display_order: number;
		status: number;
		visibility: string;
		type: string;
		moderators: string;
		moderator_ids: string;
	}>();

	// Collect all moderator IDs for batch name lookup
	const allModIds = new Set<number>();
	for (const row of forumRows.results) {
		for (const id of parseModeratorIds(row.moderator_ids ?? "")) {
			allModIds.add(id);
		}
	}

	// Fetch moderator names in one query
	let modNameMap = new Map<number, string>();
	if (allModIds.size > 0) {
		const ids = [...allModIds];
		const placeholders = ids.map(() => "?").join(",");
		const result = await env.DB.prepare(
			`SELECT id, username FROM users WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.all<{ id: number; username: string }>();
		modNameMap = new Map(result.results.map((r) => [r.id, r.username]));
	}

	// Map to tree entries
	const entries: ForumTreeEntry[] = forumRows.results.map((row) => {
		const modIds = parseModeratorIds(row.moderator_ids ?? "");
		const moderatorList: ModeratorInfo[] = modIds
			.map((id) => {
				const name = modNameMap.get(id);
				return name ? { id, name } : null;
			})
			.filter((m): m is ModeratorInfo => m !== null);

		return {
			id: row.id,
			parentId: row.parent_id,
			name: row.name,
			description: row.description,
			icon: row.icon,
			displayOrder: row.display_order,
			status: row.status,
			visibility: (row.visibility || "public") as ForumVisibility,
			type: row.type,
			moderators: row.moderators ?? "",
			moderatorIds: row.moderator_ids ?? "",
			moderatorList,
		};
	});

	// Write to KV (non-blocking for public requests, skip if flag disabled)
	if (isForumCacheEnabled(env)) {
		const payload: CachedForumTree = { forums: entries, cachedAt: Date.now() };
		const putPromise = env.KV.put(FORUM_TREE_KEY, JSON.stringify(payload), {
			expirationTtl: FORUM_TREE_TTL,
		}).catch(() => {}); // swallow put failures

		if (ctx) {
			ctx.waitUntil(putPromise);
		} else {
			// Admin context (no ctx) — await directly
			await putPromise;
		}
	}

	return entries;
}

// ─── Invalidation ───────────────────────────────────────────────────

/**
 * Invalidate the forum tree cache (best-effort, swallows errors).
 * Safe to call even when feature flag is off (no-op if key doesn't exist).
 */
export async function invalidateForumTree(env: Env): Promise<void> {
	await env.KV.delete(FORUM_TREE_KEY).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════
// Layer 2: Volatile Data Cache (last-post info, today counts, totals)
// ═══════════════════════════════════════════════════════════════════════

// ─── Types ──────────────────────────────────────────────────────────

/** Per-forum volatile data: changes on every post/thread create. */
export interface ForumVolatileEntry {
	lastThreadId: number;
	lastThreadSubject: string;
	lastPostAt: number;
	lastPosterId: number;
	lastPoster: string;
	todayThreads: number;
	threads: number;
	posts: number;
}

interface CachedForumVolatile {
	entries: Record<number, ForumVolatileEntry>;
	cachedAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const FORUM_VOLATILE_KEY = "forums:volatile:v1";
/** TTL IS the consistency guarantee for volatile data. */
const FORUM_VOLATILE_TTL = 60;

// ─── Validation ─────────────────────────────────────────────────────

/** Validate a single volatile entry has all required fields. */
function isValidVolatileEntry(entry: unknown): boolean {
	if (typeof entry !== "object" || entry === null) return false;
	const e = entry as Record<string, unknown>;
	return (
		typeof e.lastThreadId === "number" &&
		typeof e.lastThreadSubject === "string" &&
		typeof e.lastPostAt === "number" &&
		typeof e.lastPosterId === "number" &&
		typeof e.lastPoster === "string" &&
		typeof e.todayThreads === "number" &&
		typeof e.threads === "number" &&
		typeof e.posts === "number"
	);
}

/** Full shape check for cached volatile payload — rejects corrupt / schema-mismatched data. */
function isValidVolatilePayload(cached: CachedForumVolatile): boolean {
	if (
		typeof cached.entries !== "object" ||
		cached.entries === null ||
		Array.isArray(cached.entries)
	) {
		return false;
	}
	const values = Object.values(cached.entries);
	if (values.length === 0) return true;
	return values.every(isValidVolatileEntry);
}

// ─── Read-through cache ─────────────────────────────────────────────

/**
 * Get volatile forum data from KV cache, falling through to D1 on miss.
 * Returns a map of forumId → volatile entry.
 *
 * D1 fallback queries:
 * 1. Today's thread count per forum (visible threads created in last 24h)
 * 2. Visible last thread per forum (most recent visible thread's last post info)
 *
 * @param env Worker environment
 * @param ctx ExecutionContext for non-blocking KV.put
 * @param forumIds Forum IDs to fetch volatile data for
 */
export async function getForumVolatile(
	env: Env,
	ctx: ExecutionContext,
	forumIds: number[],
): Promise<Record<number, ForumVolatileEntry>> {
	// Try KV cache first (only when feature flag is enabled)
	if (isForumCacheEnabled(env)) {
		try {
			const cached = await env.KV.get<CachedForumVolatile>(FORUM_VOLATILE_KEY, "json");
			if (cached && isValidVolatilePayload(cached)) {
				return cached.entries;
			}
		} catch {
			// KV read failure — fall through to D1
		}
	}

	// D1 fallback: build volatile data from scratch
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

	// Query 1: today's visible thread count per forum
	const todayResult = await env.DB.prepare(
		"SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? AND sticky >= 0 GROUP BY forum_id",
	)
		.bind(cutoff24h)
		.all<{ forum_id: number; cnt: number }>();

	const todayMap = new Map<number, number>();
	for (const row of todayResult.results) {
		todayMap.set(row.forum_id, row.cnt);
	}

	// Query 2: forum-level counts (threads, posts) from forums table
	const forumsResult = await env.DB.prepare(
		"SELECT id, threads, posts, last_thread_id FROM forums",
	).all<{ id: number; threads: number; posts: number; last_thread_id: number }>();

	const forumsMap = new Map<number, { threads: number; posts: number; lastThreadId: number }>();
	for (const row of forumsResult.results) {
		forumsMap.set(row.id, {
			threads: row.threads,
			posts: row.posts,
			lastThreadId: row.last_thread_id,
		});
	}

	// Query 3: visible last thread per forum (most recent visible thread)
	const lastThreadResult = await fetchVisibleLastThreadsForCache(env.DB, forumIds);

	// Build volatile entries
	const entries: Record<number, ForumVolatileEntry> = {};
	for (const forumId of forumIds) {
		const counts = forumsMap.get(forumId);
		const lastThread = lastThreadResult.get(forumId);
		entries[forumId] = {
			lastThreadId: lastThread?.threadId ?? 0,
			lastThreadSubject: lastThread?.subject ?? "",
			lastPostAt: lastThread?.lastPostAt ?? 0,
			lastPosterId: lastThread?.lastPosterId ?? 0,
			lastPoster: lastThread?.lastPoster ?? "",
			todayThreads: todayMap.get(forumId) ?? 0,
			threads: counts?.threads ?? 0,
			posts: counts?.posts ?? 0,
		};
	}

	// Write to KV (non-blocking)
	if (isForumCacheEnabled(env)) {
		const payload: CachedForumVolatile = { entries, cachedAt: Date.now() };
		const putPromise = env.KV.put(FORUM_VOLATILE_KEY, JSON.stringify(payload), {
			expirationTtl: FORUM_VOLATILE_TTL,
		}).catch(() => {});
		ctx.waitUntil(putPromise);
	}

	return entries;
}

/** Helper: fetch visible last thread info per forum for cache population. */
async function fetchVisibleLastThreadsForCache(
	db: D1Database,
	forumIds: number[],
): Promise<
	Map<
		number,
		{
			threadId: number;
			subject: string;
			lastPostAt: number;
			lastPosterId: number;
			lastPoster: string;
		}
	>
> {
	if (forumIds.length === 0) return new Map();

	const result = new Map<
		number,
		{
			threadId: number;
			subject: string;
			lastPostAt: number;
			lastPosterId: number;
			lastPoster: string;
		}
	>();

	const BATCH_SIZE = 100;
	for (let i = 0; i < forumIds.length; i += BATCH_SIZE) {
		const batch = forumIds.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");

		const batchResult = await db
			.prepare(
				`SELECT t.forum_id, t.id as thread_id, t.subject, t.last_post_at, t.last_poster_id, t.last_poster
				 FROM threads t
				 INNER JOIN (
					 SELECT forum_id, MAX(last_post_at) as max_post_at
					 FROM threads
					 WHERE forum_id IN (${placeholders}) AND sticky >= 0
					 GROUP BY forum_id
				 ) sub ON t.forum_id = sub.forum_id AND t.last_post_at = sub.max_post_at
				 WHERE t.sticky >= 0`,
			)
			.bind(...batch)
			.all<{
				forum_id: number;
				thread_id: number;
				subject: string;
				last_post_at: number;
				last_poster_id: number;
				last_poster: string;
			}>();

		for (const row of batchResult.results) {
			if (!result.has(row.forum_id)) {
				result.set(row.forum_id, {
					threadId: row.thread_id,
					subject: row.subject,
					lastPostAt: row.last_post_at,
					lastPosterId: row.last_poster_id,
					lastPoster: row.last_poster,
				});
			}
		}
	}

	return result;
}

// ─── Volatile Invalidation ──────────────────────────────────────────

/**
 * Invalidate volatile forum cache (best-effort, swallows errors).
 * Use for destructive ops (delete/move) to shorten stale window.
 * Not needed for creates — TTL (60s) handles freshness.
 */
export async function invalidateForumVolatile(env: Env): Promise<void> {
	await env.KV.delete(FORUM_VOLATILE_KEY).catch(() => {});
}

/**
 * Invalidate both forum caches (tree + volatile).
 * Use for admin operations that affect structure AND counts (create/delete/merge).
 */
export async function invalidateForumCacheAll(env: Env): Promise<void> {
	await Promise.all([
		env.KV.delete(FORUM_TREE_KEY).catch(() => {}),
		env.KV.delete(FORUM_VOLATILE_KEY).catch(() => {}),
	]);
}

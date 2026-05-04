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
			if (cached?.forums) {
				return cached.forums;
			}
		} catch {
			// KV read failure — fall through to D1
		}
	}

	// D1 fallback: fetch structural fields + moderator names
	const forumRows = await env.DB.prepare(
		"SELECT id, parent_id, name, description, icon, display_order, status, visibility, type, moderator_ids FROM forums ORDER BY display_order",
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
 * Invalidate the forum tree cache. Always awaited (admin ops are infrequent).
 * Safe to call even when feature flag is off (no-op if key doesn't exist).
 */
export async function invalidateForumTree(env: Env): Promise<void> {
	await env.KV.delete(FORUM_TREE_KEY).catch(() => {});
}

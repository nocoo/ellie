/**
 * Admin viewmodel for `forum_thread_types` (主题分类) — Phase 3 / #8.
 *
 * Wraps the Worker admin surface (see apps/worker/src/handlers/admin/
 * forumThreadType.ts). The 4-switch config + per-row metadata both live
 * here; the existing forum CRUD viewmodel (`./forums.ts`) stays untouched
 * so this slice is additive only.
 *
 * Naming notes:
 *   - `id` is the synthetic D1 PK (what every list/CRUD path keys on).
 *   - `sourceTypeid` is the Discuz local typeid kept for debug / recovery.
 *     The admin UI surfaces it read-only; it cannot be edited post-create.
 *   - Worker’s `/forums/:forumId/thread-types` GET returns the FULL admin
 *     payload (`{forumId, config, types[]}`) because the route lives under
 *     `/api/admin/...` — the public flavour at `/api/v1/...` drops
 *     tombstones + suppresses sourceTypeid (different code path).
 */

import { type ApiResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Single thread-type row (admin DTO from Worker). */
export interface ForumThreadType {
	/** Synthetic D1 PK. */
	id: number;
	forumId: number;
	/** Discuz local typeid, read-only debug field. */
	sourceTypeid: number;
	name: string;
	displayOrder: number;
	icon: string;
	enabled: boolean;
	moderatorOnly: boolean;
}

/** 4-switch config block — owned by `forums` row, not by individual types. */
export interface ForumThreadTypesConfig {
	enabled: boolean;
	required: boolean;
	listable: boolean;
	prefix: boolean;
}

/**
 * Aggregate response from
 * `GET /api/admin/forums/:forumId/thread-types`. Wraps both the 4-switch
 * block (forum-scoped) and the per-row list (already sorted by
 * display_order asc, id asc on the Worker side).
 */
export interface ForumThreadTypeListResponse {
	forumId: number;
	config: ForumThreadTypesConfig;
	types: ForumThreadType[];
}

/** Body for `POST /api/admin/forums/:forumId/thread-types`. */
export interface ForumThreadTypeCreate {
	name: string;
	displayOrder?: number;
	icon?: string;
	moderatorOnly?: boolean;
	/**
	 * Reserved for backfill flows mirroring a Discuz local id. Web UI
	 * leaves this unset; Worker defaults it to 0 and rewrites to the
	 * synthetic id post-insert.
	 */
	sourceTypeid?: number;
}

/**
 * Body for `PATCH /api/admin/forum-thread-types/:id`. Worker rejects
 * unknown fields, and `sourceTypeid` is intentionally NOT editable here.
 */
export interface ForumThreadTypeUpdate {
	name?: string;
	displayOrder?: number;
	icon?: string;
	moderatorOnly?: boolean;
	enabled?: boolean;
}

/** Body for `PATCH /api/admin/forums/:forumId/thread-types-config`. */
export type ForumThreadTypesConfigUpdate = Partial<ForumThreadTypesConfig>;

/**
 * Result envelope for delete. Worker returns either a hard-delete or a
 * soft-disable depending on whether any threads still reference the row.
 */
export interface ForumThreadTypeDeleteResult {
	deleted: boolean;
	softDisabled: boolean;
	id: number;
	threadCount?: number;
}

export interface ForumThreadTypeReorderResult {
	updated: boolean;
	count: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing / re-use)
// ---------------------------------------------------------------------------

const CONFIG_KEYS: (keyof ForumThreadTypesConfig)[] = ["enabled", "required", "listable", "prefix"];

/** Stable display label per switch key. */
export function configFlagLabel(key: keyof ForumThreadTypesConfig): string {
	switch (key) {
		case "enabled":
			return "启用主题分类";
		case "required":
			return "发帖必选";
		case "listable":
			return "列表筛选";
		case "prefix":
			return "标题前缀";
	}
}

/**
 * Compute a diff from the current config to the next state — UI only
 * sends the fields that actually changed so the Worker audit log doesn't
 * record no-op flips.
 */
export function diffConfig(
	before: ForumThreadTypesConfig,
	next: ForumThreadTypesConfig,
): ForumThreadTypesConfigUpdate {
	const out: ForumThreadTypesConfigUpdate = {};
	for (const k of CONFIG_KEYS) {
		if (before[k] !== next[k]) out[k] = next[k];
	}
	return out;
}

/**
 * Mirror the Worker invariant: `required=1 ⇒ enabled=1`. UI uses this
 * pre-submit to surface a clear inline error instead of relying on the
 * Worker's 400 round-trip.
 */
export function validateConfig(cfg: ForumThreadTypesConfig): string | null {
	if (cfg.required && !cfg.enabled) {
		return "发帖必选分类时，必须先启用主题分类";
	}
	return null;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchForumThreadTypes(forumId: number): Promise<ForumThreadTypeListResponse> {
	const res = await apiClient.get<ForumThreadTypeListResponse>(
		`/api/admin/forums/${forumId}/thread-types`,
	);
	return res.data;
}

export async function createForumThreadType(
	forumId: number,
	body: ForumThreadTypeCreate,
): Promise<ForumThreadType> {
	const res: ApiResponse<ForumThreadType> = await apiClient.post<ForumThreadType>(
		`/api/admin/forums/${forumId}/thread-types`,
		body,
	);
	return res.data;
}

export async function updateForumThreadType(
	id: number,
	body: ForumThreadTypeUpdate,
): Promise<ForumThreadType> {
	const res = await apiClient.patch<ForumThreadType>(`/api/admin/forum-thread-types/${id}`, body);
	return res.data;
}

export async function deleteForumThreadType(id: number): Promise<ForumThreadTypeDeleteResult> {
	const res = await apiClient.delete<ForumThreadTypeDeleteResult>(
		`/api/admin/forum-thread-types/${id}`,
	);
	return res.data;
}

export async function reorderForumThreadTypes(
	forumId: number,
	ids: number[],
): Promise<ForumThreadTypeReorderResult> {
	const res = await apiClient.patch<ForumThreadTypeReorderResult>(
		`/api/admin/forums/${forumId}/thread-types/reorder`,
		{ ids },
	);
	return res.data;
}

export async function updateForumThreadTypesConfig(
	forumId: number,
	body: ForumThreadTypesConfigUpdate,
): Promise<{ forumId: number; config: ForumThreadTypesConfig }> {
	const res = await apiClient.patch<{ forumId: number; config: ForumThreadTypesConfig }>(
		`/api/admin/forums/${forumId}/thread-types-config`,
		body,
	);
	return res.data;
}

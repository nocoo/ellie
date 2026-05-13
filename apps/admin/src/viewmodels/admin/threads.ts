import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Mirror of the worker `toThread` mapper output
// (`apps/worker/src/lib/mappers.ts`). The worker admin list/detail endpoints
// return `columns: "*"` and pass each row through `toThread`, so dropping
// fields here only loses information in the UI — the bytes are already on
// the wire. The fields below were previously absent from the admin viewmodel
// and re-added in Phase H.1 so list / detail pages can render parity with
// the user-facing forum (forum link, last poster, type chip, etc.).
export interface Thread {
	id: number;
	subject: string;
	forumId: number;
	authorId: number;
	authorName: string;
	/** Avatar URL — populated by worker from the user KV cache; "" if unknown. */
	authorAvatar: string;
	/** R2 key for the avatar; "" if unknown. Mirrors `authorAvatar` semantics. */
	authorAvatarPath: string;
	replies: number;
	views: number;
	sticky: number;
	closed: number;
	digest: number;
	highlight: number;
	/** Last reply timestamp (unix seconds). 0 when the thread has no replies. */
	lastPostAt: number;
	/** Username of the most recent poster; "" when no reply yet. */
	lastPoster: string;
	/** User id of the most recent poster; 0 when no reply yet. */
	lastPosterId: number;
	/** Avatar URL of the most recent poster; "" if unknown. */
	lastPosterAvatar: string;
	/** R2 key for the last-poster avatar; "" if unknown. */
	lastPosterAvatarPath: string;
	createdAt: number;
	/** Thread type chip (e.g. "公告", "投票"); "" when unset. */
	typeName: string;
	/** Forum-specific special flag (1=announcement, 2=poll, …); 0 default. */
	special: number;
	/** Editorial recommendations counter. */
	recommends: number;
	/** True when this thread is the author's first thread in any forum. */
	isAuthorFirstThread: boolean;
}

export interface ThreadFilters {
	forumId?: number;
	authorId?: number;
	authorName?: string;
	subject?: string;
	sticky?: number;
	closed?: number;
	digest?: number;
	/**
	 * Exact match against the encoded `highlight` bitmask. Almost never useful
	 * from the UI (real values are 24-bit RGB packs); prefer `highlighted`.
	 */
	highlight?: number;
	/**
	 * Boolean-style filter on `highlight`: `1`/`true` → `highlight > 0`,
	 * `0`/`false` → `highlight = 0`. Wired through the worker `positive`
	 * filter type so the UI can offer "已高亮 / 未高亮" without leaking the
	 * bitmask encoding.
	 */
	highlighted?: 0 | 1 | boolean;
	page?: number;
	limit?: number;
}

export interface ThreadUpdate {
	subject?: string;
	sticky?: number;
	digest?: number;
	closed?: number;
	highlight?: number;
	forumId?: number;
}

export interface DeleteResult {
	deleted: boolean;
	deletedPosts: number;
}

// Batch result contracts mirror the worker exactly so callers don't drift:
//   batchDelete  → { deleted: true, count }
//   batchMove    → { moved: true,   count, forumId }
// `count` reflects rows the worker actually touched (after dedupe + missing
// row drop for delete, after `already in target` skip for move). Don't
// rename to `affected` — that was a stale guess that previously rendered
// `undefined` in the success banner.
export interface BatchDeleteResult {
	deleted: boolean;
	count: number;
}

export interface BatchMoveResult {
	moved: boolean;
	count: number;
	forumId: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function buildThreadSearchParams(
	filters: ThreadFilters,
): Record<string, string | number | boolean | undefined | null> {
	// `highlighted` accepts boolean or 0/1; normalise to the "1"/"0" strings the
	// worker `positive` filter expects (so a bare `false` doesn't get dropped
	// by api-client's truthy filter).
	let highlighted: string | undefined;
	if (filters.highlighted === true || filters.highlighted === 1) highlighted = "1";
	else if (filters.highlighted === false || filters.highlighted === 0) highlighted = "0";
	return {
		page: filters.page,
		limit: filters.limit,
		forumId: filters.forumId ?? undefined,
		authorId: filters.authorId ?? undefined,
		authorName: filters.authorName || undefined,
		subject: filters.subject || undefined,
		sticky: filters.sticky ?? undefined,
		closed: filters.closed ?? undefined,
		digest: filters.digest ?? undefined,
		highlight: filters.highlight ?? undefined,
		highlighted,
	};
}

export function stickyLabel(level: number): string {
	switch (level) {
		case 1:
			return "版块置顶";
		case 2:
			return "全局置顶";
		case 3:
			return "分类置顶";
		default:
			return "";
	}
}

export function digestLabel(level: number): string {
	switch (level) {
		case 1:
			return "精华 I";
		case 2:
			return "精华 II";
		case 3:
			return "精华 III";
		default:
			return "";
	}
}

// Phase H.2 — list page surfaces forum name per row. The worker returns
// `forumId` only (no denormalised name), so the page fetches the flat forum
// list on mount and resolves names client-side.
//
// Falls back to `#<id>` so the column never renders empty / "undefined" when
// the forum list is still loading or a thread points at a forum that was
// since hidden. Callers can branch on the fallback (it always starts with
// "#") if they want to render a placeholder differently.
export function forumNameById(forums: { id: number; name: string }[], forumId: number): string {
	for (const f of forums) if (f.id === forumId) return f.name;
	return `#${forumId}`;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchThreads(filters: ThreadFilters): Promise<PaginatedResponse<Thread>> {
	return apiClient.getList<Thread>("/api/admin/threads", buildThreadSearchParams(filters));
}

export async function fetchThread(id: number): Promise<Thread> {
	const res = await apiClient.get<Thread>(`/api/admin/threads/${id}`);
	return res.data;
}

export async function updateThread(id: number, data: ThreadUpdate): Promise<Thread> {
	const res = await apiClient.patch<Thread>(`/api/admin/threads/${id}`, data);
	return res.data;
}

export async function deleteThread(id: number): Promise<DeleteResult> {
	const res = await apiClient.delete<DeleteResult>(`/api/admin/threads/${id}`);
	return res.data;
}

export async function batchDeleteThreads(ids: number[]): Promise<BatchDeleteResult> {
	const res = await apiClient.post<BatchDeleteResult>("/api/admin/threads/batch-delete", { ids });
	return res.data;
}

export async function batchMoveThreads(ids: number[], forumId: number): Promise<BatchMoveResult> {
	const res = await apiClient.post<BatchMoveResult>("/api/admin/threads/batch-move", {
		ids,
		forumId,
	});
	return res.data;
}

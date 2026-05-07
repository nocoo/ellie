import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Thread {
	id: number;
	subject: string;
	forumId: number;
	authorId: number;
	authorName: string;
	replies: number;
	views: number;
	sticky: number;
	closed: number;
	digest: number;
	highlight: number;
	lastPostAt: number;
	createdAt: number;
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

export interface BatchResult {
	affected: number;
}

export interface MoveResult {
	affected: number;
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

export async function batchDeleteThreads(ids: number[]): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/threads/batch-delete", { ids });
	return res.data;
}

export async function batchMoveThreads(ids: number[], forumId: number): Promise<MoveResult> {
	const res = await apiClient.post<MoveResult>("/api/admin/threads/batch-move", { ids, forumId });
	return res.data;
}

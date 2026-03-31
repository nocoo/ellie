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
	highlight?: number;
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

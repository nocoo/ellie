import { type PaginatedResponse, adminApi } from "@/lib/admin-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Thread {
	tid: number;
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
	lastPostAt: string | null;
	createdAt: string;
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
			return "Forum Sticky";
		case 2:
			return "Global Sticky";
		case 3:
			return "Super Sticky";
		default:
			return "";
	}
}

export function digestLabel(level: number): string {
	switch (level) {
		case 1:
			return "Digest I";
		case 2:
			return "Digest II";
		case 3:
			return "Digest III";
		default:
			return "";
	}
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchThreads(filters: ThreadFilters): Promise<PaginatedResponse<Thread>> {
	return adminApi.getList<Thread>("/api/admin/threads", buildThreadSearchParams(filters));
}

export async function fetchThread(id: number): Promise<Thread> {
	const res = await adminApi.get<Thread>(`/api/admin/threads/${id}`);
	return res.data;
}

export async function updateThread(id: number, data: ThreadUpdate): Promise<Thread> {
	const res = await adminApi.patch<Thread>(`/api/admin/threads/${id}`, data);
	return res.data;
}

export async function deleteThread(id: number): Promise<DeleteResult> {
	const res = await adminApi.delete<DeleteResult>(`/api/admin/threads/${id}`);
	return res.data;
}

export async function batchDeleteThreads(ids: number[]): Promise<BatchResult> {
	const res = await adminApi.post<BatchResult>("/api/admin/threads/batch-delete", { ids });
	return res.data;
}

export async function batchMoveThreads(ids: number[], forumId: number): Promise<MoveResult> {
	const res = await adminApi.post<MoveResult>("/api/admin/threads/batch-move", { ids, forumId });
	return res.data;
}

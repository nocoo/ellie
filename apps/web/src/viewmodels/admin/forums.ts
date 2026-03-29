import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Forum {
	id: number;
	name: string;
	description: string;
	threads: number;
	posts: number;
	order: number;
	status: number;
	createdAt: string;
}

export interface ForumFilters {
	search?: string;
	status?: number | null;
	page?: number;
	limit?: number;
}

export interface ForumCreate {
	name: string;
	description?: string;
	order?: number;
	status?: number;
}

export interface ForumUpdate {
	name?: string;
	description?: string;
	order?: number;
	status?: number;
}

export interface MergeResult {
	merged: boolean;
	movedThreads: number;
}

export interface ReorderResult {
	reordered: boolean;
}

export interface DeleteResult {
	deleted: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Build search params from ForumFilters, omitting empty values. */
export function buildForumSearchParams(
	filters: ForumFilters,
): Record<string, string | number | boolean | undefined | null> {
	return {
		page: filters.page,
		limit: filters.limit,
		search: filters.search || undefined,
		status: filters.status ?? undefined,
	};
}

/** Map forum status number to display label. */
export function statusLabel(status: number): string {
	switch (status) {
		case -1:
			return "Hidden";
		default:
			return "Active";
	}
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchForums(filters: ForumFilters): Promise<PaginatedResponse<Forum>> {
	return apiClient.getList<Forum>("/api/admin/forums", buildForumSearchParams(filters));
}

export async function fetchForum(id: number): Promise<Forum> {
	const res = await apiClient.get<Forum>(`/api/admin/forums/${id}`);
	return res.data;
}

export async function createForum(data: ForumCreate): Promise<Forum> {
	const res = await apiClient.post<Forum>("/api/admin/forums", data);
	return res.data;
}

export async function updateForum(id: number, data: ForumUpdate): Promise<Forum> {
	const res = await apiClient.patch<Forum>(`/api/admin/forums/${id}`, data);
	return res.data;
}

export async function deleteForum(id: number): Promise<DeleteResult> {
	const res = await apiClient.delete<DeleteResult>(`/api/admin/forums/${id}`);
	return res.data;
}

export async function mergeForums(sourceId: number, targetId: number): Promise<MergeResult> {
	const res = await apiClient.post<MergeResult>(`/api/admin/forums/${sourceId}/merge`, {
		targetId,
	});
	return res.data;
}

export async function reorderForums(ids: number[]): Promise<ReorderResult> {
	const res = await apiClient.post<ReorderResult>("/api/admin/forums/reorder", { ids });
	return res.data;
}

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
	displayOrder: number;
	status: number;
	createdAt: string;
}

export interface ForumCreate {
	name: string;
	description?: string;
	displayOrder?: number;
	status?: number;
}

export interface ForumUpdate {
	name?: string;
	description?: string;
	displayOrder?: number;
	status?: number;
}

export interface MergeResult {
	merged: boolean;
	movedThreads: number;
}

export interface ReorderItem {
	id: number;
	displayOrder: number;
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

/** Map forum status number to display label. Worker uses 0=hidden, 1=active. */
export function statusLabel(status: number): string {
	switch (status) {
		case 0:
			return "Hidden";
		case 1:
			return "Active";
		default:
			return "Unknown";
	}
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchForums(): Promise<PaginatedResponse<Forum>> {
	return apiClient.getList<Forum>("/api/admin/forums");
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

export async function mergeForums(sourceId: number, targetForumId: number): Promise<MergeResult> {
	const res = await apiClient.post<MergeResult>(`/api/admin/forums/${sourceId}/merge`, {
		targetForumId,
	});
	return res.data;
}

export async function reorderForums(orders: ReorderItem[]): Promise<ReorderResult> {
	const res = await apiClient.post<ReorderResult>("/api/admin/forums/reorder", { orders });
	return res.data;
}

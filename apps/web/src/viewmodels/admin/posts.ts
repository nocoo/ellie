import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Post {
	id: number;
	threadId: number;
	forumId: number;
	content: string;
	authorId: number;
	authorName: string;
	isFirst: boolean;
	position: number;
	createdAt: number;
}

export interface PostFilters {
	threadId?: number;
	authorId?: number;
	authorName?: string;
	content?: string;
	sort?: string;
	page?: number;
	limit?: number;
}

export interface PostUpdate {
	content?: string;
}

export interface DeleteResult {
	deleted: boolean;
}

export interface BatchResult {
	affected: number;
	skipped: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function buildPostSearchParams(
	filters: PostFilters,
): Record<string, string | number | boolean | undefined | null> {
	return {
		page: filters.page,
		limit: filters.limit,
		threadId: filters.threadId ?? undefined,
		authorId: filters.authorId ?? undefined,
		authorName: filters.authorName || undefined,
		content: filters.content || undefined,
		sort: filters.sort || undefined,
	};
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchPosts(filters: PostFilters): Promise<PaginatedResponse<Post>> {
	return apiClient.getList<Post>("/api/admin/posts", buildPostSearchParams(filters));
}

export async function fetchPost(id: number): Promise<Post> {
	const res = await apiClient.get<Post>(`/api/admin/posts/${id}`);
	return res.data;
}

export async function updatePost(id: number, data: PostUpdate): Promise<Post> {
	const res = await apiClient.patch<Post>(`/api/admin/posts/${id}`, data);
	return res.data;
}

export async function deletePost(id: number): Promise<DeleteResult> {
	const res = await apiClient.delete<DeleteResult>(`/api/admin/posts/${id}`);
	return res.data;
}

export async function batchDeletePosts(ids: number[]): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/posts/batch-delete", { ids });
	return res.data;
}

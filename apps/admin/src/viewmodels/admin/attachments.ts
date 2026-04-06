import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Attachment {
	id: number;
	postId: number;
	filename: string;
	filePath: string;
	fileSize: number;
	isImage: boolean;
	hasThumb: boolean;
	downloads: number;
	authorId: number;
	threadId: number;
	createdAt: number;
}

export interface AttachmentFilters {
	postId?: number;
	threadId?: number;
	authorId?: number;
	isImage?: boolean;
	page?: number;
	limit?: number;
}

export interface DeleteResult {
	deleted: boolean;
}

export interface BatchResult {
	affected: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function buildAttachmentSearchParams(
	filters: AttachmentFilters,
): Record<string, string | number | boolean | undefined | null> {
	return {
		page: filters.page,
		limit: filters.limit,
		postId: filters.postId ?? undefined,
		threadId: filters.threadId ?? undefined,
		authorId: filters.authorId ?? undefined,
		isImage: filters.isImage ?? undefined,
	};
}

export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${Number.parseFloat(value.toFixed(2))} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchAttachments(
	filters: AttachmentFilters,
): Promise<PaginatedResponse<Attachment>> {
	return apiClient.getList<Attachment>(
		"/api/admin/attachments",
		buildAttachmentSearchParams(filters),
	);
}

export async function fetchAttachment(id: number): Promise<Attachment> {
	const res = await apiClient.get<Attachment>(`/api/admin/attachments/${id}`);
	return res.data;
}

export async function deleteAttachment(id: number): Promise<DeleteResult> {
	const res = await apiClient.delete<DeleteResult>(`/api/admin/attachments/${id}`);
	return res.data;
}

export async function batchDeleteAttachments(ids: number[]): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/attachments/batch-delete", { ids });
	return res.data;
}

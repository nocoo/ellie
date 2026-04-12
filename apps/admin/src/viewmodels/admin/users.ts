import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
	id: number;
	username: string;
	email: string;
	avatar: string;
	role: number;
	status: number;
	threads: number;
	posts: number;
	credits: number;
	regDate: number;
	lastLogin: number;
	regIp?: string;
	lastIp?: string;
}

export interface UserFilters {
	username?: string;
	email?: string;
	status?: number | null;
	role?: number | null;
	page?: number;
	limit?: number;
}

export interface UserUpdate {
	username?: string;
	email?: string;
	avatar?: string;
	status?: number;
	role?: number;
	credits?: number;
}

export interface BanResult {
	banned: boolean;
	deletedContent?: number;
}

export interface NukeResult {
	nuked: boolean;
	deletedThreads: number;
	deletedPosts: number;
}

export interface BatchResult {
	affected: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Build search params from UserFilters, omitting empty values. */
export function buildUserSearchParams(
	filters: UserFilters,
): Record<string, string | number | boolean | undefined | null> {
	return {
		page: filters.page,
		limit: filters.limit,
		username: filters.username || undefined,
		email: filters.email || undefined,
		status: filters.status ?? undefined,
		role: filters.role ?? undefined,
	};
}

/** Map role number to display label. */
export function roleLabel(role: number): string {
	switch (role) {
		case 1:
			return "管理员";
		case 2:
			return "超级版主";
		case 3:
			return "版主";
		default:
			return "会员";
	}
}

/** Map status number to display label. */
export function statusLabel(status: number): string {
	switch (status) {
		case -1:
			return "已封禁";
		case -2:
			return "已归档";
		default:
			return "正常";
	}
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchUsers(filters: UserFilters): Promise<PaginatedResponse<User>> {
	return apiClient.getList<User>("/api/admin/users", buildUserSearchParams(filters));
}

export async function fetchUser(id: number): Promise<User> {
	const res = await apiClient.get<User>(`/api/admin/users/${id}`);
	return res.data;
}

export async function updateUser(id: number, data: UserUpdate): Promise<User> {
	const res = await apiClient.patch<User>(`/api/admin/users/${id}`, data);
	return res.data;
}

export async function banUser(id: number, deleteContent?: boolean): Promise<BanResult> {
	const res = await apiClient.post<BanResult>(`/api/admin/users/${id}/ban`, { deleteContent });
	return res.data;
}

export async function nukeUser(id: number): Promise<NukeResult> {
	const res = await apiClient.post<NukeResult>(`/api/admin/users/${id}/nuke`);
	return res.data;
}

export async function batchSetStatus(ids: number[], status: number): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/users/batch-status", { ids, status });
	return res.data;
}

export async function batchSetRole(ids: number[], role: number): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/users/batch-role", { ids, role });
	return res.data;
}

export async function fetchUsersByIds(ids: number[]): Promise<User[]> {
	if (ids.length === 0) return [];
	const res = await apiClient.get<User[]>("/api/admin/users/batch", { ids: ids.join(",") });
	return res.data;
}

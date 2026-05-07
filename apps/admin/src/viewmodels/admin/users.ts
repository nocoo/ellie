import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
	id: number;
	username: string;
	email: string;
	avatar: string;
	/** GUID-based avatar path (e.g. "avatars/abc.jpg"); empty string when not set. Direct CDN address. */
	avatarPath?: string;
	role: number;
	status: number;
	threads: number;
	posts: number;
	credits: number;
	regDate: number;
	lastLogin: number;
	regIp?: string;
	lastIp?: string;
	/** D4 tombstone — unix seconds when admin purged this user. 0 if never. */
	purgedAt?: number;
	/** D4 tombstone — admin user id who issued purge. 0 if never. */
	purgedBy?: number;
	/**
	 * Admin-list-only enrichment from worker `enrichListRows`. Number of
	 * private messages where the user is sender OR receiver (mirrors
	 * `purgeUser` pre-flight semantics). Absent on detail / non-list paths.
	 */
	messagesCount?: number;
	/**
	 * Admin-list-only enrichment from worker `enrichListRows`. Number of
	 * `attachments` rows uploaded by this user (`author_id`).
	 */
	attachmentsCount?: number;
}

export interface UserFilters {
	username?: string;
	email?: string;
	status?: number | null;
	role?: number | null;
	regIp?: string;
	lastIp?: string;
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

export interface UnbanResult {
	unbanned: boolean;
	id: number;
	previousStatus: number;
}

export interface NukeResult {
	nuked: boolean;
	deletedThreads: number;
	deletedPosts: number;
}

export interface PurgeDeletedCounts {
	threads: number;
	posts: number;
	comments: number;
	attachments: number;
	messages: number;
}

export interface PurgeR2Failure {
	key: string;
	error: string;
}

export interface PurgeResult {
	purged: true;
	id: number;
	deleted: PurgeDeletedCounts;
	audit: { actorEmail: string; actorName: string };
	r2: { deletedCount: number; failed: PurgeR2Failure[] };
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
		regIp: filters.regIp || undefined,
		lastIp: filters.lastIp || undefined,
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
		case -99:
			return "已清除";
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

export async function unbanUser(id: number): Promise<UnbanResult> {
	const res = await apiClient.post<UnbanResult>(`/api/admin/users/${id}/unban`);
	return res.data;
}

export async function nukeUser(id: number): Promise<NukeResult> {
	const res = await apiClient.post<NukeResult>(`/api/admin/users/${id}/nuke`);
	return res.data;
}

/**
 * D4-d: Irreversible content cleanup + tombstone + R2 purge.
 *
 * Sends `{ confirm: "ok" }` — a fixed token, not the username. The dialog
 * gates the operator on typing `ok`; the Worker re-validates server-side
 * (`CONFIRM_MISMATCH` if the token is anything else). Staff users
 * (role > 0) are rejected with `CANNOT_PURGE_STAFF`. Already-purged users
 * are rejected with `ALREADY_PURGED`. UI surfaces these via the dialog
 * inline error.
 */
export async function purgeUser(id: number): Promise<PurgeResult> {
	const res = await apiClient.post<PurgeResult>(`/api/admin/users/${id}/purge`, {
		confirm: "ok",
	});
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

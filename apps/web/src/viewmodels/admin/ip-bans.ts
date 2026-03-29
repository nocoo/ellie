import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpBan {
	id: number;
	ip: string;
	reason: string;
	adminId: number;
	adminName: string;
	expiresAt: number | null;
	createdAt: number;
}

export interface IpBanFilters {
	ip?: string;
	expired?: boolean;
	page?: number;
	limit?: number;
}

export interface IpBanCreate {
	ip: string;
	reason?: string;
	expiresAt?: number | null;
}

export interface IpBanUpdate {
	reason?: string;
	expiresAt?: number | null;
}

export interface IpCheckResult {
	banned: boolean;
	matchingBans?: IpBan[];
}

export interface BatchResult {
	affected: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Build search params from IpBanFilters, omitting empty values. */
export function buildIpBanSearchParams(
	filters: IpBanFilters,
): Record<string, string | number | boolean | undefined | null> {
	return {
		page: filters.page,
		limit: filters.limit,
		ip: filters.ip || undefined,
		expired: filters.expired ?? undefined,
	};
}

/** Format an expiration date for display. Returns "Never" when null. */
export function formatExpiry(expiresAt: number | null): string {
	if (!expiresAt) return "Never";
	return new Date(expiresAt * 1000).toLocaleString();
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchIpBans(filters: IpBanFilters): Promise<PaginatedResponse<IpBan>> {
	return apiClient.getList<IpBan>("/api/admin/ip-bans", buildIpBanSearchParams(filters));
}

export async function fetchIpBan(id: number): Promise<IpBan> {
	const res = await apiClient.get<IpBan>(`/api/admin/ip-bans/${id}`);
	return res.data;
}

export async function createIpBan(data: IpBanCreate): Promise<IpBan> {
	const res = await apiClient.post<IpBan>("/api/admin/ip-bans", data);
	return res.data;
}

export async function updateIpBan(id: number, data: IpBanUpdate): Promise<IpBan> {
	const res = await apiClient.patch<IpBan>(`/api/admin/ip-bans/${id}`, data);
	return res.data;
}

export async function deleteIpBan(id: number): Promise<{ deleted: boolean }> {
	const res = await apiClient.delete<{ deleted: boolean }>(`/api/admin/ip-bans/${id}`);
	return res.data;
}

export async function batchDeleteIpBans(ids: number[]): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/ip-bans/batch-delete", { ids });
	return res.data;
}

export async function checkIp(ip: string): Promise<IpCheckResult> {
	const res = await apiClient.get<IpCheckResult>("/api/admin/ip-bans/check-ip", { ip });
	return res.data;
}

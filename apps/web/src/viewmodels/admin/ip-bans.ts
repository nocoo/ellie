import { type PaginatedResponse, adminApi } from "@/lib/admin-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpBan {
	id: number;
	ip: string;
	reason: string;
	createdBy: string;
	expiresAt: string | null;
	createdAt: string;
}

export interface IpBanFilters {
	ip?: string;
	reason?: string;
	page?: number;
	limit?: number;
}

export interface IpBanCreate {
	ip: string;
	reason?: string;
	expiresAt?: string;
}

export interface IpBanUpdate {
	ip?: string;
	reason?: string;
	expiresAt?: string | null;
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
		reason: filters.reason || undefined,
	};
}

/** Format an expiration date for display. Returns "Never" when null. */
export function formatExpiry(expiresAt: string | null): string {
	if (!expiresAt) return "Never";
	return new Date(expiresAt).toLocaleString();
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchIpBans(filters: IpBanFilters): Promise<PaginatedResponse<IpBan>> {
	return adminApi.getList<IpBan>("/api/admin/ip-bans", buildIpBanSearchParams(filters));
}

export async function fetchIpBan(id: number): Promise<IpBan> {
	const res = await adminApi.get<IpBan>(`/api/admin/ip-bans/${id}`);
	return res.data;
}

export async function createIpBan(data: IpBanCreate): Promise<IpBan> {
	const res = await adminApi.post<IpBan>("/api/admin/ip-bans", data);
	return res.data;
}

export async function updateIpBan(id: number, data: IpBanUpdate): Promise<IpBan> {
	const res = await adminApi.patch<IpBan>(`/api/admin/ip-bans/${id}`, data);
	return res.data;
}

export async function deleteIpBan(id: number): Promise<{ deleted: boolean }> {
	const res = await adminApi.delete<{ deleted: boolean }>(`/api/admin/ip-bans/${id}`);
	return res.data;
}

export async function batchDeleteIpBans(ids: number[]): Promise<BatchResult> {
	const res = await adminApi.post<BatchResult>("/api/admin/ip-bans/batch-delete", { ids });
	return res.data;
}

export async function checkIp(ip: string): Promise<IpCheckResult> {
	const res = await adminApi.get<IpCheckResult>("/api/admin/ip-bans/check-ip", { ip });
	return res.data;
}

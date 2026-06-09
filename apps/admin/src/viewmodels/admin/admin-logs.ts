/**
 * Admin operation logs viewmodel — read-only wrapper over GET /api/admin/admin-logs.
 *
 * Worker filter contract (apps/worker/src/handlers/admin/adminLog.ts):
 *   adminId, action, targetType, targetId, startDate, endDate, page, limit
 * Dates are unix seconds; createdAt is unix seconds.
 *
 * No mutation API — admin logs are produced internally by writeAdminLog.
 */

import { apiClient, type PaginatedResponse } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminLog {
	id: number;
	adminId: number;
	adminName: string;
	action: string;
	targetType: string;
	targetId: number | null;
	/** Raw JSON string from the worker. May be empty / non-JSON. */
	details: string;
	ip: string;
	createdAt: number;
}

export interface AdminLogFilters {
	action?: string;
	targetType?: string;
	targetId?: number;
	adminId?: number;
	/** Unix seconds, inclusive lower bound. */
	startDate?: number;
	/** Unix seconds, inclusive upper bound. */
	endDate?: number;
	page?: number;
	limit?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Build search params from AdminLogFilters, omitting empty / undefined values. */
export function buildAdminLogSearchParams(
	filters: AdminLogFilters,
): Record<string, string | number | undefined> {
	return {
		page: filters.page,
		limit: filters.limit,
		action: filters.action || undefined,
		targetType: filters.targetType || undefined,
		targetId: filters.targetId,
		adminId: filters.adminId,
		startDate: filters.startDate,
		endDate: filters.endDate,
	};
}

export type ParsedDetails = { ok: true; value: unknown } | { ok: false; raw: string };

/**
 * Try to parse the `details` blob as JSON.
 *
 * Falls back to raw text on:
 *   - empty / whitespace-only string (returns `{ ok: false, raw: "" }` so caller can render placeholder)
 *   - JSON.parse failure
 */
export function parseDetails(details: string | null | undefined): ParsedDetails {
	const raw = details ?? "";
	if (raw.trim() === "") return { ok: false, raw: "" };
	try {
		return { ok: true, value: JSON.parse(raw) };
	} catch {
		return { ok: false, raw };
	}
}

/**
 * Whitelist of target types that get a clickable detail / list link.
 * Unknown types render as plain text.
 *
 * Decisions (locked with reviewer):
 *   - user   → /admin/users/{id}     (detail page exists)
 *   - thread → /admin/threads/{id}   (detail page exists)
 *   - report → /admin/reports?id={id} (no detail route yet; query param reserved for future highlight)
 *   - forum  → /admin/forums          (no per-forum detail route; link to list)
 */
export function targetHref(targetType: string, targetId: number | null): string | null {
	if (targetType === "user" && targetId != null) return `/admin/users/${targetId}`;
	if (targetType === "thread" && targetId != null) return `/admin/threads/${targetId}`;
	if (targetType === "report" && targetId != null) return `/admin/reports?id=${targetId}`;
	if (targetType === "forum") return "/admin/forums";
	return null;
}

/** Format `target_type#id` (or just type when id is null). */
export function formatTarget(targetType: string, targetId: number | null): string {
	if (!targetType) return "";
	if (targetId == null) return targetType;
	return `${targetType}#${targetId}`;
}

/** Format unix-second timestamp for table display (locale-sensitive). */
export function formatLogTime(ts: number): string {
	if (!ts) return "";
	return new Date(ts * 1000).toLocaleString();
}

/**
 * Convert an `<input type="date">` value (`"YYYY-MM-DD"`) to a unix-second
 * boundary in the local timezone.
 *
 *   bound="start" → local 00:00:00.000
 *   bound="end"   → local 23:59:59.999
 *
 * Returns undefined for empty / malformed input so the caller can omit the
 * query param entirely.
 */
export function dateInputToUnix(value: string, bound: "start" | "end"): number | undefined {
	if (!value) return undefined;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!m) return undefined;
	const year = Number(m[1]);
	const month = Number(m[2]) - 1;
	const day = Number(m[3]);
	const d =
		bound === "start"
			? new Date(year, month, day, 0, 0, 0, 0)
			: new Date(year, month, day, 23, 59, 59, 999);
	const ms = d.getTime();
	if (Number.isNaN(ms)) return undefined;
	return Math.floor(ms / 1000);
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchAdminLogs(
	filters: AdminLogFilters,
): Promise<PaginatedResponse<AdminLog>> {
	return apiClient.getList<AdminLog>("/api/admin/admin-logs", buildAdminLogSearchParams(filters));
}

export async function fetchAdminLog(id: number): Promise<AdminLog> {
	const res = await apiClient.get<AdminLog>(`/api/admin/admin-logs/${id}`);
	return res.data;
}

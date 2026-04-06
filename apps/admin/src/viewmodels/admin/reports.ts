/**
 * Admin Reports ViewModel — report management types and API functions.
 *
 * Ref: docs/13-report-system.md
 */

import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Report status */
export type ReportStatus = "pending" | "resolved" | "dismissed";

/** Report record (from admin API, includes threadId) */
export interface Report {
	id: number;
	type: "post";
	targetId: number;
	reporterId: number;
	reporterName: string;
	reason: string;
	status: ReportStatus;
	handlerId: number | null;
	handlerName: string;
	handledAt: number | null;
	createdAt: number;
	/** Thread ID for navigation (from JOIN query) */
	threadId: number | null;
}

/** Report list filter parameters */
export interface ReportListParams {
	status?: ReportStatus;
	type?: "post";
	reporterId?: number;
	page?: number;
	limit?: number;
}

/** Batch operation result */
export interface BatchResult {
	affected: number;
	skipped: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Report status options for filter dropdown */
export const REPORT_STATUS_OPTIONS: { value: ReportStatus | ""; label: string }[] = [
	{ value: "", label: "全部状态" },
	{ value: "pending", label: "待处理" },
	{ value: "resolved", label: "已处理" },
	{ value: "dismissed", label: "已驳回" },
];

/** Status badge colors */
export const STATUS_COLORS: Record<ReportStatus, { bg: string; text: string }> = {
	pending: {
		bg: "bg-yellow-100 dark:bg-yellow-900/30",
		text: "text-yellow-800 dark:text-yellow-200",
	},
	resolved: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-200" },
	dismissed: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400" },
};

/** Status labels */
export const STATUS_LABELS: Record<ReportStatus, string> = {
	pending: "待处理",
	resolved: "已处理",
	dismissed: "已驳回",
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

export function buildReportSearchParams(
	params: ReportListParams,
): Record<string, string | number | undefined> {
	return {
		page: params.page,
		limit: params.limit,
		status: params.status || undefined,
		type: params.type || undefined,
		reporterId: params.reporterId,
	};
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetch paginated reports list.
 */
export async function fetchReports(
	params: ReportListParams = {},
): Promise<PaginatedResponse<Report>> {
	return apiClient.getList<Report>("/api/admin/reports", buildReportSearchParams(params));
}

/**
 * Fetch single report detail.
 */
export async function fetchReport(id: number): Promise<Report> {
	const res = await apiClient.get<Report>(`/api/admin/reports/${id}`);
	return res.data;
}

/**
 * Update report status (resolve or dismiss).
 */
export async function updateReportStatus(id: number, status: ReportStatus): Promise<Report> {
	const res = await apiClient.patch<Report>(`/api/admin/reports/${id}`, { status });
	return res.data;
}

/**
 * Batch delete reports (single delete uses [id] array).
 */
export async function batchDeleteReports(ids: number[]): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/reports/batch-delete", { ids });
	return res.data;
}

/**
 * Delete a single report (convenience wrapper).
 */
export async function deleteReport(id: number): Promise<BatchResult> {
	return batchDeleteReports([id]);
}

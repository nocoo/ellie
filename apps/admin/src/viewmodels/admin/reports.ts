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

/** Report target type — must stay in sync with worker REPORT_TYPES. */
export type ReportType = "thread" | "post" | "user";

/** Report record (from admin API, includes per-type target metadata) */
export interface Report {
	id: number;
	type: ReportType;
	targetId: number;
	reporterId: number;
	reporterName: string;
	reason: string;
	status: ReportStatus;
	handlerId: number | null;
	handlerName: string;
	handledAt: number | null;
	createdAt: number;
	/**
	 * Thread ID for navigation:
	 *  - type=post   → parent thread of the reported post (from posts JOIN)
	 *  - type=thread → the thread itself (== targetId)
	 *  - type=user   → null
	 * `null` when the joined row is missing (target deleted).
	 */
	threadId: number | null;
	/** Thread title for `post`/`thread` reports (null when target missing). */
	targetTitle: string | null;
	/** Username for `user` reports (null when target missing or other type). */
	targetName: string | null;
}

/** Report list filter parameters */
export interface ReportListParams {
	status?: ReportStatus;
	type?: ReportType;
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

/** Status labels */
export const STATUS_LABELS: Record<ReportStatus, string> = {
	pending: "待处理",
	resolved: "已处理",
	dismissed: "已驳回",
};

/** Report type filter dropdown options */
export const REPORT_TYPE_OPTIONS: { value: ReportType | ""; label: string }[] = [
	{ value: "", label: "全部类型" },
	{ value: "thread", label: "主题" },
	{ value: "post", label: "回帖" },
	{ value: "user", label: "用户" },
];

/** Type labels (used for table cell) */
export const TYPE_LABELS: Record<ReportType, string> = {
	thread: "主题",
	post: "回帖",
	user: "用户",
};

/**
 * Resolve the admin route a report's target should link to.
 * Returns `null` when the target row no longer exists (deleted/tombstoned).
 *
 * Routing:
 *  - thread → /admin/threads/:targetId
 *  - post   → /admin/threads/:threadId  (no stable per-post anchor in admin)
 *  - user   → /admin/users/:targetId
 */
export function getReportTargetAdminLink(report: Report): string | null {
	if (report.type === "thread") {
		return report.threadId ? `/admin/threads/${report.threadId}` : null;
	}
	if (report.type === "post") {
		return report.threadId ? `/admin/threads/${report.threadId}` : null;
	}
	// user — only link if the target still exists (targetName non-null).
	return report.targetName ? `/admin/users/${report.targetId}` : null;
}

/**
 * Human-readable label for a report's target (column cell + dialog row).
 * Falls back to `#<id>` when the target row is missing.
 */
export function getReportTargetLabel(report: Report): string {
	if (report.type === "user") {
		return report.targetName ? `@${report.targetName}` : `#${report.targetId}`;
	}
	// thread / post — show thread title when available
	return report.targetTitle ? report.targetTitle : `#${report.targetId}`;
}

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

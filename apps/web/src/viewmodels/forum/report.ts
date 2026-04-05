/**
 * Report (举报) ViewModel — post report data types and API hooks.
 *
 * Ref: docs/13-report-system.md
 */

import { ApiError, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Preset report reasons (matches Worker REPORT_REASONS) */
export const REPORT_REASONS = [
	"垃圾广告",
	"违规内容",
	"人身攻击",
	"虚假信息",
	"侵权内容",
	"其他",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Report submission payload */
export interface ReportPayload {
	postId: number;
	reason: ReportReason;
}

/** Report submission result */
export interface ReportResult {
	id: number;
	postId: number;
	reason: string;
	createdAt: number;
}

/** Report permission response */
export interface ReportPermission {
	allowed: boolean;
	reason?: string;
}

// ---------------------------------------------------------------------------
// API Functions (client-side)
// ---------------------------------------------------------------------------

/**
 * Check if user can submit reports (reuses posting permission endpoint).
 */
export async function checkReportPermission(): Promise<ReportPermission> {
	try {
		const result = await apiClient.get<ReportPermission>("/api/v1/posting-permission");
		return result.data;
	} catch (err) {
		if (err instanceof ApiError) {
			// Not authenticated or permission denied
			return { allowed: false, reason: err.message };
		}
		throw err;
	}
}

/**
 * Submit a report for a post.
 */
export async function submitReport(payload: ReportPayload): Promise<ReportResult> {
	const result = await apiClient.post<ReportResult>("/api/v1/reports", payload);
	return result.data;
}

// ---------------------------------------------------------------------------
// Re-export ApiError for component use
// ---------------------------------------------------------------------------

export { ApiError };

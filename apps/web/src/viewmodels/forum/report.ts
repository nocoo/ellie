/**
 * Report (举报) ViewModel — type-aware report data types and API hooks.
 *
 * Supports reporting threads, posts, and users.
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

/** Report target type (matches Worker REPORT_TYPES) */
export type ReportTargetType = "thread" | "post" | "user";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Report submission payload (frontend-friendly).
 *
 * Use {targetType, targetId} for new code. The legacy {postId} form is kept
 * as a backwards-compatible shortcut and is equivalent to
 * {targetType: 'post', targetId: postId}.
 */
export type ReportPayload =
	| { targetType: ReportTargetType; targetId: number; reason: ReportReason }
	| { postId: number; reason: ReportReason };

/** Report submission result (from API) */
export interface ReportResult {
	id: number;
	type: ReportTargetType;
	targetId: number;
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
 * Normalize a ReportPayload into the API contract { type, targetId, reason }.
 * Accepts both the new {targetType,targetId} form and the legacy {postId} form.
 */
function normalizeReportPayload(payload: ReportPayload): {
	type: ReportTargetType;
	targetId: number;
	reason: ReportReason;
} {
	if ("targetType" in payload) {
		return { type: payload.targetType, targetId: payload.targetId, reason: payload.reason };
	}
	return { type: "post", targetId: payload.postId, reason: payload.reason };
}

/**
 * Submit a report. Accepts thread / post / user targets.
 */
export async function submitReport(payload: ReportPayload): Promise<ReportResult> {
	const apiPayload = normalizeReportPayload(payload);
	const result = await apiClient.post<ReportResult>("/api/v1/reports", apiPayload);
	return result.data;
}

// ---------------------------------------------------------------------------
// Re-export ApiError for component use
// ---------------------------------------------------------------------------

export { ApiError };

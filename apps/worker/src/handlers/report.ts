// User report handlers for Cloudflare Worker
// Ref: docs/13-report-system.md §4

import type { Env } from "../lib/env";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withAuth } from "../lib/routeHelpers";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

// ─── Constants ───────────────────────────────────────────────

export const REPORT_REASONS = [
	"垃圾广告",
	"违规内容",
	"人身攻击",
	"虚假信息",
	"侵权内容",
	"其他",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** 24 hours in seconds */
const DUPLICATE_REPORT_WINDOW = 24 * 60 * 60;

// ─── #75 POST /api/v1/reports ────────────────────────────────
// Submit a post report

export const create = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Parse body
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { type, targetId, reason } = body;

	// Validate type — only 'post' is supported in this release
	if (type !== "post") {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Only 'post' type is supported" },
			origin,
		);
	}

	// Validate targetId
	if (typeof targetId !== "number" || !Number.isInteger(targetId) || targetId <= 0) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "targetId must be a positive integer" },
			origin,
		);
	}

	// Validate reason
	if (typeof reason !== "string" || !REPORT_REASONS.includes(reason as ReportReason)) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: `reason must be one of: ${REPORT_REASONS.join(", ")}` },
			origin,
		);
	}

	// Check posting permission (reuse existing logic)
	const permissionResult = await checkPostingPermission(env, user, origin);
	if (!permissionResult.allowed) {
		return permissionResult.error;
	}

	// Check target post exists and get author_id
	const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ?")
		.bind(targetId)
		.first<{ id: number; author_id: number }>();

	if (!post) {
		return errorResponse("TARGET_NOT_FOUND", 404, { message: "Post not found" }, origin);
	}

	// Check cannot report own post
	if (post.author_id === user.userId) {
		return errorResponse(
			"CANNOT_REPORT_SELF",
			400,
			{ message: "You cannot report your own post" },
			origin,
		);
	}

	// Check duplicate report (24h window)
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - DUPLICATE_REPORT_WINDOW;

	const existingReport = await env.DB.prepare(
		"SELECT 1 FROM reports WHERE reporter_id = ? AND type = 'post' AND target_id = ? AND created_at > ?",
	)
		.bind(user.userId, targetId, windowStart)
		.first();

	if (existingReport) {
		return errorResponse(
			"DUPLICATE_REPORT",
			400,
			{ message: "You have already reported this post within the last 24 hours" },
			origin,
		);
	}

	// Get reporter username
	const reporter = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ username: string }>();

	const reporterName = reporter?.username ?? "";

	// Insert report
	const result = await env.DB.prepare(
		`INSERT INTO reports (type, target_id, reporter_id, reporter_name, reason, status, created_at)
		 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
	)
		.bind("post", targetId, user.userId, reporterName, reason, now)
		.run();

	const reportId = result.meta.last_row_id;

	return jsonResponse(
		{
			id: reportId,
			type: "post",
			targetId,
			reason,
			createdAt: now,
		},
		origin,
		undefined,
		201,
	);
});

// ─── #76 GET /api/v1/posting-permission ──────────────────────
// Check if current user can post (for report dialog Step 1)

export const checkPermission = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	const permissionResult = await checkPostingPermission(env, user, origin);

	if (permissionResult.allowed) {
		return jsonResponse({ allowed: true }, origin);
	}

	// Extract reason from error response
	// Error structure: { error: { code, message, details?: { message } } }
	// The Chinese reason is in details.message, not error.message
	const errorBody = (await permissionResult.error.clone().json()) as {
		error?: { message?: string; details?: { message?: string } };
	};
	const reason =
		errorBody?.error?.details?.message ?? errorBody?.error?.message ?? "您暂时无法操作";

	return jsonResponse({ allowed: false, reason }, origin);
});

// ─── OPTIONS handlers ────────────────────────────────────────

export function optionsReports(request: Request): Response {
	const origin = request.headers.get("Origin") ?? undefined;
	return new Response(null, {
		status: 204,
		headers: corsHeaders(origin),
	});
}

export function optionsPostingPermission(request: Request): Response {
	const origin = request.headers.get("Origin") ?? undefined;
	return new Response(null, {
		status: 204,
		headers: corsHeaders(origin),
	});
}

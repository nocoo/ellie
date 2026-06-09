import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { canViewForumVisibility } from "@ellie/types";
import type { Env } from "../lib/env";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withAuthVerified, withVerifiedEmail } from "../lib/routeHelpers";
import { isForumActive, POST_VISIBLE, THREAD_VISIBLE } from "../lib/visibility";
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

export const REPORT_TYPES = ["thread", "post", "user"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** 24 hours in seconds */
const DUPLICATE_REPORT_WINDOW = 24 * 60 * 60;

// ─── Target resolution ───────────────────────────────────────

interface ResolveOk {
	ok: true;
	/** Author/owner of the target — used for self-report check. */
	authorId: number;
}
interface ResolveFail {
	ok: false;
}
type ResolveResult = ResolveOk | ResolveFail;

/**
 * Resolve a report target by type and verify it is visible to the reporter.
 * Returns the target's "owner" id (post.author / thread.author / user.id)
 * so the caller can apply a uniform self-report check.
 *
 * - thread: must satisfy THREAD_VISIBLE + forum active + reporter visibility.
 * - post:   must satisfy POST_VISIBLE, then its thread must be visible too.
 * - user:   must exist and not be tombstoned (status != -99).
 */
async function resolveReportTarget(
	env: Env,
	type: ReportType,
	targetId: number,
	visCtx: VisibilityContext,
): Promise<ResolveResult> {
	if (type === "post") {
		const post = await env.DB.prepare(
			`SELECT id, thread_id, author_id FROM posts WHERE id = ? AND ${POST_VISIBLE}`,
		)
			.bind(targetId)
			.first<{ id: number; thread_id: number; author_id: number }>();
		if (!post) return { ok: false };

		const thread = await env.DB.prepare(
			`SELECT forum_id FROM threads WHERE id = ? AND ${THREAD_VISIBLE}`,
		)
			.bind(post.thread_id)
			.first<{ forum_id: number }>();
		if (!thread) return { ok: false };

		const forum = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
			.bind(thread.forum_id)
			.first<{ status: number; visibility: string }>();
		if (!isForumActive(forum)) return { ok: false };
		if (!canViewForumVisibility(forum.visibility as ForumVisibility, visCtx)) {
			return { ok: false };
		}
		return { ok: true, authorId: post.author_id };
	}

	if (type === "thread") {
		const thread = await env.DB.prepare(
			`SELECT id, forum_id, author_id FROM threads WHERE id = ? AND ${THREAD_VISIBLE}`,
		)
			.bind(targetId)
			.first<{ id: number; forum_id: number; author_id: number }>();
		if (!thread) return { ok: false };

		const forum = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
			.bind(thread.forum_id)
			.first<{ status: number; visibility: string }>();
		if (!isForumActive(forum)) return { ok: false };
		if (!canViewForumVisibility(forum.visibility as ForumVisibility, visCtx)) {
			return { ok: false };
		}
		return { ok: true, authorId: thread.author_id };
	}

	// type === "user"
	const target = await env.DB.prepare("SELECT id, status FROM users WHERE id = ?")
		.bind(targetId)
		.first<{ id: number; status: number }>();
	if (!target) return { ok: false };
	// Tombstoned users cannot be reported.
	if (target.status === -99) return { ok: false };
	return { ok: true, authorId: target.id };
}

// ─── #75 POST /api/v1/reports ────────────────────────────────
// Submit a report against a thread, post, or user.

export const create = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Parse body
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { type, targetId, reason } = body;

	// Validate type — must be one of the supported report targets.
	if (typeof type !== "string" || !REPORT_TYPES.includes(type as ReportType)) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: `type must be one of: ${REPORT_TYPES.join(", ")}` },
			origin,
		);
	}
	const reportType = type as ReportType;

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

	// Resolve target (visibility + existence)
	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	const resolved = await resolveReportTarget(env, reportType, targetId, visCtx);
	if (!resolved.ok) {
		return errorResponse("TARGET_NOT_FOUND", 404, { message: "Target not found" }, origin);
	}

	// Self-report check (uniform across types via resolved.authorId)
	if (resolved.authorId === user.userId) {
		return errorResponse(
			"CANNOT_REPORT_SELF",
			400,
			{ message: "You cannot report your own content" },
			origin,
		);
	}

	// Duplicate report check (24h window) — keyed on (reporter, type, target_id)
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - DUPLICATE_REPORT_WINDOW;

	// Duplicate-report check + reporter-username lookup are independent —
	// fire in parallel to halve D1 round-trip latency.
	const [existingReport, reporter] = await Promise.all([
		env.DB.prepare(
			"SELECT 1 FROM reports WHERE reporter_id = ? AND type = ? AND target_id = ? AND created_at > ?",
		)
			.bind(user.userId, reportType, targetId, windowStart)
			.first(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
	]);

	if (existingReport) {
		return errorResponse(
			"DUPLICATE_REPORT",
			400,
			{ message: "You have already reported this target within the last 24 hours" },
			origin,
		);
	}

	const reporterName = reporter?.username ?? "";

	// Insert report
	const result = await env.DB.prepare(
		`INSERT INTO reports (type, target_id, reporter_id, reporter_name, reason, status, created_at)
		 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
	)
		.bind(reportType, targetId, user.userId, reporterName, reason, now)
		.run();

	const reportId = result.meta.last_row_id;

	return jsonResponse(
		{
			id: reportId,
			type: reportType,
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
// Comprehensive write-gate check: email verification + posting restrictions.
// Used by the frontend write-gate preflight before opening any write dialog.
// Accepts ?action=thread|reply|comment|message|report to check action-specific
// content switches (allow_new_thread, allow_reply).
// Returns { allowed: true } or { allowed: false, reason, code } so the
// frontend can show action-specific guidance (e.g. "go verify email",
// "go set avatar").

/** Map frontend action to backend ContentType for checkPostingPermission */
function actionToContentType(action: string | null): "thread" | "reply" | "message" {
	switch (action) {
		case "thread":
			return "thread";
		case "reply":
		case "comment":
			return "reply";
		default:
			// "message", "report", null, or unknown → "message" (no content switch checks)
			return "message";
	}
}

export const checkPermission = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const action = url.searchParams.get("action");

	// Check email verification first (withAuthVerified doesn't check this)
	const emailRow = await env.DB.prepare("SELECT email_verified_at FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ email_verified_at: number }>();

	if (emailRow && emailRow.email_verified_at === 0) {
		return jsonResponse(
			{
				allowed: false,
				reason: "请先验证邮箱后再进行操作",
				code: "EMAIL_NOT_VERIFIED",
			},
			origin,
		);
	}

	const contentType = actionToContentType(action);
	const permissionResult = await checkPostingPermission(env, user, origin, contentType);

	if (permissionResult.allowed) {
		return jsonResponse({ allowed: true }, origin);
	}

	// Extract code and reason from error response
	// Error structure: { error: { code, message, details?: { message, code } } }
	// The Chinese reason is in details.message, the sub-code in details.code
	const errorBody = (await permissionResult.error.clone().json()) as {
		error?: {
			code?: string;
			message?: string;
			details?: { message?: string; code?: string };
		};
	};
	const reason =
		errorBody?.error?.details?.message ?? errorBody?.error?.message ?? "您暂时无法操作";
	const code = errorBody?.error?.details?.code ?? errorBody?.error?.code ?? "POSTING_RESTRICTION";

	return jsonResponse({ allowed: false, reason, code }, origin);
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

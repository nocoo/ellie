// Admin login-history endpoints (P4) — three handlers for the
// auth-attempt audit trail surfaced on the analytics dashboard:
//
//   - GET  /api/admin/analytics/today/logins
//       KPI aggregates for "today" (Asia/Shanghai). Aggregate-only;
//       serves D1 realtime with `Cache-Control: no-store, private`
//       so admins see immediate counters after moderation actions.
//   - GET  /api/admin/analytics/today/logins/list
//       Paginated, masked detail list. Reads D1 in realtime (no KV).
//       Response is `Cache-Control: no-store, private`.
//   - POST /api/admin/analytics/login-history/:id/reveal
//       Reveal raw ip + ua for ONE row. Writes admin_logs row
//       (`analytics.login_history.reveal`) on the success path and
//       returns `Cache-Control: no-store, private`. 404 / 400 do NOT
//       write to admin_logs.
//
// The reveal endpoint is POST (not GET) so the Next admin proxy's
// `adminApiAs(admin, request).raw("POST", ...)` injects the
// `X-Admin-Actor-Email` / `X-Admin-Actor-Name` headers needed for
// `resolveActor` to record a non-system actor. CSRF is auto-enforced
// by the BFF on POST methods.
//
// All three handlers are gated by `withEntityAuth(loginHistoryConfig)`
// — Key B verification happens at the router level (apiKey middleware);
// the wrapper is here only for the factory pattern (see
// `apps/worker/src/lib/adminHelpers.ts`).

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

// ─── Constants ───────────────────────────────────────────────────

const LOCAL_TZ_OFFSET_SEC = 8 * 3600;
const SEC_PER_DAY = 86_400;

const LIST_PAGE_SIZE_MAX = 100;
const LIST_PAGE_SIZE_DEFAULT = 20;

// ─── Auth wrapper (P2 analytics pattern) ────────────────────────

const loginHistoryConfig: EntityConfig = {
	table: "",
	entityName: "LOGIN_HISTORY",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

// ─── Helpers ─────────────────────────────────────────────────────

/** Asia/Shanghai local midnight (Unix-seconds) for the day containing `now`. */
function localTodayStart(now: number): number {
	return Math.floor((now + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY) * SEC_PER_DAY - LOCAL_TZ_OFFSET_SEC;
}

/** Mask IPv4 keeping the first two octets: `1.2.3.4` → `1.2.x.x`.
 *  IPv6 keeps first two `:` groups, replaces tail with `::x`.
 *  Anything that doesn't match either canonical shape (including empty
 *  string, junk, or partial fragments) collapses to a fixed `unknown`
 *  placeholder so this default-masked endpoint NEVER leaks a raw value
 *  that wasn't recognized as a shape we know how to mask. */
function maskIp(ip: string): string {
	if (ip?.includes(".")) {
		const parts = ip.split(".");
		if (parts.length === 4 && parts.every((p) => p.length > 0 && /^\d+$/.test(p))) {
			return `${parts[0]}.${parts[1]}.x.x`;
		}
	}
	if (ip?.includes(":")) {
		const parts = ip.split(":");
		if (parts.length >= 3 && parts[0].length > 0 && parts[1].length > 0) {
			return `${parts[0]}:${parts[1]}::x`;
		}
	}
	return "unknown";
}

// ─── KPI shape ──────────────────────────────────────────────────

interface TodayLoginsKpi {
	now: number;
	dayStart: number; // local-midnight Unix-seconds
	totalAttempts: number;
	successAttempts: number;
	failedAttempts: number;
	uniqueUsers: number; // distinct user_id (NULL excluded) among success rows
	uniqueIps: number; // distinct ip among all rows
	loginAttempts: number; // kind = 'login'
	registerAttempts: number; // kind = 'register'
}

// ─── Loaders ─────────────────────────────────────────────────────

/**
 * Load today's KPIs in a single SQL pass (sum of conditionals over the
 * day-window). One scan keeps the query cheap on the time-leading
 * `idx_login_history_created` index.
 */
async function loadKpi(env: Env, nowSec: number): Promise<TodayLoginsKpi> {
	const dayStart = localTodayStart(nowSec);
	const row = await env.DB.prepare(
		`SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS success,
			SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
			COUNT(DISTINCT CASE WHEN ok = 1 AND user_id IS NOT NULL THEN user_id END) AS unique_users,
			COUNT(DISTINCT ip) AS unique_ips,
			SUM(CASE WHEN kind = 'login' THEN 1 ELSE 0 END) AS login_attempts,
			SUM(CASE WHEN kind = 'register' THEN 1 ELSE 0 END) AS register_attempts
		FROM login_history
		WHERE created_at >= ?`,
	)
		.bind(dayStart)
		.first<{
			total: number | null;
			success: number | null;
			failed: number | null;
			unique_users: number | null;
			unique_ips: number | null;
			login_attempts: number | null;
			register_attempts: number | null;
		}>();
	return {
		now: nowSec,
		dayStart,
		totalAttempts: Number(row?.total ?? 0),
		successAttempts: Number(row?.success ?? 0),
		failedAttempts: Number(row?.failed ?? 0),
		uniqueUsers: Number(row?.unique_users ?? 0),
		uniqueIps: Number(row?.unique_ips ?? 0),
		loginAttempts: Number(row?.login_attempts ?? 0),
		registerAttempts: Number(row?.register_attempts ?? 0),
	};
}

// ─── List shape ──────────────────────────────────────────────────

interface MaskedListRow {
	id: number;
	userId: number | null;
	username: string;
	ok: 0 | 1;
	kind: string;
	errorCode: string;
	ipMasked: string;
	botClass: string;
	createdAt: number;
}

// ─── Handlers ────────────────────────────────────────────────────

/** GET /api/admin/analytics/today/logins — KPI card (no-store). */
async function kpiHandler(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const payload = await loadKpi(env, Math.floor(Date.now() / 1000));
	return jsonNoStoreResponse(payload, origin);
}

/** GET /api/admin/analytics/today/logins/list — masked detail list. */
async function listHandler(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const nowSec = Math.floor(Date.now() / 1000);
	const dayStart = localTodayStart(nowSec);

	// Filters
	const conditions: string[] = ["created_at >= ?"];
	const params: unknown[] = [dayStart];

	const okFilter = url.searchParams.get("ok");
	if (okFilter === "0" || okFilter === "1") {
		conditions.push("ok = ?");
		params.push(Number.parseInt(okFilter, 10));
	}
	const kindFilter = url.searchParams.get("kind");
	if (kindFilter === "login" || kindFilter === "register") {
		conditions.push("kind = ?");
		params.push(kindFilter);
	}
	const errorCodeFilter = url.searchParams.get("errorCode");
	if (errorCodeFilter) {
		// Bounded: server-side enum check is the responsibility of the BFF;
		// the worker accepts any non-empty string but still parameter-binds.
		conditions.push("error_code = ?");
		params.push(errorCodeFilter);
	}

	const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
	const rawLimit = Number.parseInt(
		url.searchParams.get("limit") ?? String(LIST_PAGE_SIZE_DEFAULT),
		10,
	);
	const limit = Math.min(
		LIST_PAGE_SIZE_MAX,
		Math.max(1, Number.isFinite(rawLimit) ? rawLimit : LIST_PAGE_SIZE_DEFAULT),
	);
	const offset = (page - 1) * limit;

	const where = conditions.join(" AND ");

	const [countRow, listResult] = await Promise.all([
		env.DB.prepare(`SELECT COUNT(*) AS total FROM login_history WHERE ${where}`)
			.bind(...params)
			.first<{ total: number }>(),
		env.DB.prepare(
			`SELECT id, user_id, username, ok, kind, error_code, ip, bot_class, created_at
			 FROM login_history
			 WHERE ${where}
			 ORDER BY created_at DESC
			 LIMIT ? OFFSET ?`,
		)
			.bind(...params, limit, offset)
			.all<{
				id: number;
				user_id: number | null;
				username: string;
				ok: 0 | 1;
				kind: string;
				error_code: string;
				ip: string;
				bot_class: string;
				created_at: number;
			}>(),
	]);

	const rows: MaskedListRow[] = (listResult.results ?? []).map((r) => ({
		id: r.id,
		userId: r.user_id,
		username: r.username,
		ok: r.ok,
		kind: r.kind,
		errorCode: r.error_code,
		ipMasked: maskIp(r.ip),
		botClass: r.bot_class,
		createdAt: r.created_at,
	}));

	return jsonNoStoreResponse(
		{
			page,
			limit,
			total: countRow?.total ?? 0,
			rows,
		},
		origin,
	);
}

/** POST /api/admin/analytics/login-history/:id/reveal — un-mask one row. */
async function revealHandler(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	// Method gate: BFF GET / HEAD must not reach this code, but pin it
	// for defense-in-depth — a misconfigured proxy must NOT reveal data.
	if (request.method !== "POST") {
		return errorResponse(
			"METHOD_NOT_ALLOWED",
			405,
			{ message: "POST required for reveal" },
			origin,
		);
	}

	const url = new URL(request.url);
	const match = url.pathname.match(/\/login-history\/(\d+)\/reveal$/);
	if (!match) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Bad path" }, origin);
	}
	const id = Number.parseInt(match[1], 10);
	if (!Number.isFinite(id) || id <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Bad login_history id" }, origin);
	}

	const row = await env.DB.prepare(
		`SELECT id, user_id, username, ok, kind, error_code, ip, user_agent, bot_class, created_at
		 FROM login_history
		 WHERE id = ?`,
	)
		.bind(id)
		.first<{
			id: number;
			user_id: number | null;
			username: string;
			ok: 0 | 1;
			kind: string;
			error_code: string;
			ip: string;
			user_agent: string;
			bot_class: string;
			created_at: number;
		}>();

	if (!row) {
		// Critical: 404 does NOT writeAdminLog. We refuse to leave a trail
		// for IDs the admin probed but couldn't see.
		return errorResponse("LOGIN_HISTORY_NOT_FOUND", 404, undefined, origin);
	}

	// Success path: write admin_logs BEFORE returning so a downstream
	// network blip never returns the reveal without an audit row. Best-
	// effort by contract (writeAdminLog is fire-and-forget on the catch
	// side), but we still await so the row is in flight before we
	// respond.
	await writeAdminLog(env, resolveActor(request, env), {
		action: "analytics.login_history.reveal",
		targetType: "login_history",
		targetId: row.id,
		// Intentionally exclude raw ip / ua / username from `details` —
		// the audit trail records WHO revealed WHICH row, not the
		// underlying PII (that is already on the login_history row
		// itself, accessible via the same admin endpoint).
		details: {
			loginHistoryId: row.id,
			ok: row.ok,
			kind: row.kind,
			errorCode: row.error_code,
			botClass: row.bot_class,
			createdAt: row.created_at,
		},
	});

	return jsonNoStoreResponse(
		{
			id: row.id,
			userId: row.user_id,
			username: row.username,
			ok: row.ok,
			kind: row.kind,
			errorCode: row.error_code,
			ip: row.ip,
			userAgent: row.user_agent,
			botClass: row.bot_class,
			createdAt: row.created_at,
		},
		origin,
	);
}

// ─── Exports (router wires by name) ─────────────────────────────

export const getTodayLoginsKpi = withEntityAuth(loginHistoryConfig, kpiHandler);
export const getTodayLoginsList = withEntityAuth(loginHistoryConfig, listHandler);
export const revealLoginHistory = withEntityAuth(loginHistoryConfig, revealHandler);

// Pure helpers — exported for unit tests only.
export const _internal = {
	localTodayStart,
	maskIp,
	loadKpi,
	loginHistoryConfig,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_DEFAULT,
};

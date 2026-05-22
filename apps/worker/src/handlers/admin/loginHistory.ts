// Admin login-history endpoints (P4) — two handlers for the
// auth-attempt audit trail surfaced on the analytics dashboard:
//
//   - GET  /api/admin/analytics/today/logins
//       KPI aggregates for "today" (Asia/Shanghai). Aggregate-only;
//       serves D1 realtime with `Cache-Control: no-store, private`
//       so admins see immediate counters after moderation actions.
//   - GET  /api/admin/analytics/today/logins/list
//       Paginated detail list with raw IP + UA. Admin-only.
//       Response is `Cache-Control: no-store, private`.
//
// Both handlers are gated by `withEntityAuth(loginHistoryConfig)`
// — Key B verification happens at the router level (apiKey middleware);
// the wrapper is here only for the factory pattern.

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";

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

interface ListRow {
	id: number;
	userId: number | null;
	username: string;
	ok: 0 | 1;
	kind: string;
	errorCode: string;
	ip: string;
	userAgent: string;
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

/** GET /api/admin/analytics/today/logins/list — detail list (raw IP, admin-only). */
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
			`SELECT id, user_id, username, ok, kind, error_code, ip, user_agent, bot_class, created_at
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
				user_agent: string;
				bot_class: string;
				created_at: number;
			}>(),
	]);

	const rows: ListRow[] = (listResult.results ?? []).map((r) => ({
		id: r.id,
		userId: r.user_id,
		username: r.username,
		ok: r.ok,
		kind: r.kind,
		errorCode: r.error_code,
		ip: r.ip,
		userAgent: r.user_agent,
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

// ─── Exports (router wires by name) ─────────────────────────────

export const getTodayLoginsKpi = withEntityAuth(loginHistoryConfig, kpiHandler);
export const getTodayLoginsList = withEntityAuth(loginHistoryConfig, listHandler);

// Pure helpers — exported for unit tests only.
export const _internal = {
	localTodayStart,
	maskIp,
	loadKpi,
	loginHistoryConfig,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_DEFAULT,
};

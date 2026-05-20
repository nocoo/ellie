// Admin "today visits" page-view dashboard endpoints (P5).
//
// Two handlers backing the `今日访问名单` panel on the analytics dashboard:
//
//   - GET /api/admin/analytics/today/visits
//       KPI aggregates for today (Asia/Shanghai). KV-cached under family
//       `analytics:today-visits` (60s TTL). Aggregate-only — value carries
//       NO ip / ua / username. The dashboard's "活跃用户/访客（含匿名）"
//       counter is computed as:
//
//         activeUsers  = COUNT(DISTINCT user_id WHERE user_id > 0)
//         anonPresent  = 1 if any row has user_id = 0, else 0
//
//       The UI labels the sum `activeUsers + anonPresent` as
//       "活跃用户/访客（含匿名）" — reviewer-pinned to avoid the
//       "独立访客" claim (the aggregate has no per-session dedup; an
//       anonymous viewer is counted at most once-per-day in aggregate
//       only because the collector key contains user_id=0).
//
//   - GET /api/admin/analytics/today/visits/list
//       Paginated realtime list (no KV) of today's per-target rollups.
//       Filters by `path_kind`. Each row carries a label batched in
//       from the source table (thread.subject / forum.name /
//       user.username). Response is `Cache-Control: no-store, private`
//       — aligned with the P4 today-logins list pattern even though
//       this row shape is not PII; the list MUST always reflect the
//       latest flush.
//
// Trust posture:
//   - Both endpoints are Key B admin (router-level `validateApiKey`).
//   - The aggregate `analytics_daily_targets` is the source of truth.
//     Neither handler reads `login_history`, ip, or ua.
//   - Reveal endpoint is intentionally absent: the aggregate does not
//     persist ip/ua, so there is nothing to reveal.

import { withEntityAuth } from "../../lib/adminHelpers";
import type { PathKind } from "../../lib/analytics/types";
import { cacheGetOrSet } from "../../lib/cache/wrap";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
import { buildJsonHeaders } from "../../middleware/cors";
import { errorResponse } from "../../middleware/error";

// ─── Constants ────────────────────────────────────────────────────

const LOCAL_TZ_OFFSET_SEC = 8 * 3600;
const SEC_PER_DAY = 86_400;

const KPI_TTL_SEC = 60;
const KPI_KV_KEY = "analytics:today-visits";
const KPI_FAMILY = "analytics:today-visits";

const LIST_PAGE_SIZE_MAX = 100;
const LIST_PAGE_SIZE_DEFAULT = 20;

/** Strict whitelist of allowed `path_kind` filter values. Mirrors
 *  `PathKind` exactly; declared as a Set so an out-of-enum filter is
 *  rejected with 400 instead of being silently bound into the SQL. */
const PATH_KIND_VALUES: ReadonlySet<PathKind> = new Set<PathKind>([
	"thread",
	"forum",
	"user",
	"home",
	"digest",
	"search",
	"checkin",
	"messages",
	"auth_page",
	"other",
]);

// ─── Auth wrapper ─────────────────────────────────────────────────

const todayVisitsConfig: EntityConfig = {
	table: "",
	entityName: "TODAY_VISITS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

// ─── Helpers ──────────────────────────────────────────────────────

/** `YYYY-MM-DD` in Asia/Shanghai for the day containing `nowSec`. */
function shanghaiDateLocal(nowSec: number): string {
	const localDayStart =
		Math.floor((nowSec + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY) * SEC_PER_DAY - LOCAL_TZ_OFFSET_SEC;
	const d = new Date(localDayStart * 1000 + LOCAL_TZ_OFFSET_SEC * 1000);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** No-store/private JSON response — used by the list endpoint. */
function jsonNoStoreResponse<T>(data: T, origin?: string): Response {
	const headers = buildJsonHeaders(origin);
	headers["Cache-Control"] = "no-store, private";
	return new Response(
		JSON.stringify({
			data,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
			},
		}),
		{ headers },
	);
}

// ─── KPI shape + validator ───────────────────────────────────────

interface PathKindBreakdownEntry {
	pathKind: PathKind;
	views: number;
	targets: number;
}

interface TodayVisitsKpi {
	now: number;
	dateLocal: string;
	totalViews: number;
	humanViews: number;
	botSearchViews: number;
	botOtherViews: number;
	unknownViews: number;
	/** Distinct (path_kind, target_id) tuples covered by today's rollups. */
	distinctTargets: number;
	/** Distinct signed-in user_id (user_id > 0). */
	activeUsers: number;
	/** 1 if at least one row has user_id = 0 (anonymous bucket), else 0. */
	anonPresent: 0 | 1;
	byPathKind: PathKindBreakdownEntry[];
}

function isTodayVisitsKpi(v: unknown): v is TodayVisitsKpi {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	if (typeof o.now !== "number") return false;
	if (typeof o.dateLocal !== "string") return false;
	for (const k of [
		"totalViews",
		"humanViews",
		"botSearchViews",
		"botOtherViews",
		"unknownViews",
		"distinctTargets",
		"activeUsers",
	] as const) {
		if (typeof o[k] !== "number") return false;
	}
	if (o.anonPresent !== 0 && o.anonPresent !== 1) return false;
	if (!Array.isArray(o.byPathKind)) return false;
	for (const e of o.byPathKind) {
		if (!e || typeof e !== "object") return false;
		const x = e as Record<string, unknown>;
		if (typeof x.pathKind !== "string" || !PATH_KIND_VALUES.has(x.pathKind as PathKind))
			return false;
		if (typeof x.views !== "number" || typeof x.targets !== "number") return false;
	}
	return true;
}

// ─── List shape ──────────────────────────────────────────────────

interface TodayVisitsListRow {
	pathKind: PathKind;
	targetId: number;
	label: string;
	views: number;
	humanViews: number;
	botSearchViews: number;
	botOtherViews: number;
	unknownViews: number;
	uniqueUsers: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

// ─── KPI loader ─────────────────────────────────────────────────

/**
 * Load today's KPI counters in two cheap reads:
 *
 *   1. A single conditional-SUM aggregate over today's window (uses
 *      `idx_analytics_daily_targets_list` thanks to the date_local
 *      leading column).
 *   2. A small per-path_kind summary used by the dashboard breakdown.
 *
 * Both reads are bound to `date_local = today_iso`. The aggregate
 * already pre-rolls per (path_kind, target_id, user_id, bot_class), so
 * `COUNT(*)` on the filtered slice gives `distinctTargets`-after-the-
 * user_id/bot_class fanout — the dashboard wants the (path_kind,
 * target_id) tuple count instead, so we use COUNT(DISTINCT) on the
 * concatenation.
 */
async function loadKpi(env: Env, nowSec: number): Promise<TodayVisitsKpi> {
	const dateLocal = shanghaiDateLocal(nowSec);
	const [aggRow, breakdown] = await env.DB.batch([
		env.DB.prepare(
			`SELECT
				COALESCE(SUM(count), 0) AS total_views,
				COALESCE(SUM(CASE WHEN bot_class = 'human'      THEN count ELSE 0 END), 0) AS human_views,
				COALESCE(SUM(CASE WHEN bot_class = 'bot_search' THEN count ELSE 0 END), 0) AS bot_search_views,
				COALESCE(SUM(CASE WHEN bot_class = 'bot_other'  THEN count ELSE 0 END), 0) AS bot_other_views,
				COALESCE(SUM(CASE WHEN bot_class = 'unknown'    THEN count ELSE 0 END), 0) AS unknown_views,
				COUNT(DISTINCT path_kind || '#' || target_id) AS distinct_targets,
				COUNT(DISTINCT CASE WHEN user_id > 0 THEN user_id END) AS active_users,
				MAX(CASE WHEN user_id = 0 THEN 1 ELSE 0 END) AS anon_present
			FROM analytics_daily_targets
			WHERE date_local = ?`,
		).bind(dateLocal),
		env.DB.prepare(
			`SELECT
				path_kind AS path_kind,
				COALESCE(SUM(count), 0) AS views,
				COUNT(DISTINCT target_id) AS targets
			FROM analytics_daily_targets
			WHERE date_local = ?
			GROUP BY path_kind
			ORDER BY views DESC, path_kind ASC`,
		).bind(dateLocal),
	]);

	const agg = (aggRow.results?.[0] ?? {}) as {
		total_views?: number;
		human_views?: number;
		bot_search_views?: number;
		bot_other_views?: number;
		unknown_views?: number;
		distinct_targets?: number;
		active_users?: number;
		anon_present?: number | null;
	};

	const byPathKindRaw = (breakdown.results ?? []) as Array<{
		path_kind: string;
		views: number;
		targets: number;
	}>;
	const byPathKind: PathKindBreakdownEntry[] = [];
	for (const r of byPathKindRaw) {
		if (PATH_KIND_VALUES.has(r.path_kind as PathKind)) {
			byPathKind.push({
				pathKind: r.path_kind as PathKind,
				views: Number(r.views ?? 0),
				targets: Number(r.targets ?? 0),
			});
		}
	}

	return {
		now: nowSec,
		dateLocal,
		totalViews: Number(agg.total_views ?? 0),
		humanViews: Number(agg.human_views ?? 0),
		botSearchViews: Number(agg.bot_search_views ?? 0),
		botOtherViews: Number(agg.bot_other_views ?? 0),
		unknownViews: Number(agg.unknown_views ?? 0),
		distinctTargets: Number(agg.distinct_targets ?? 0),
		activeUsers: Number(agg.active_users ?? 0),
		anonPresent: agg.anon_present === 1 ? 1 : 0,
		byPathKind,
	};
}

// ─── List loader (with batched label lookup) ────────────────────

/**
 * Per (path_kind, target_id) rollup for today. Aggregates across
 * user_id + bot_class so the UI sees one row per visited target with
 * total view count plus bot-class breakdown.
 */
async function loadListPage(
	env: Env,
	nowSec: number,
	pathKindFilter: PathKind | null,
	page: number,
	limit: number,
): Promise<{ total: number; rows: TodayVisitsListRow[] }> {
	const dateLocal = shanghaiDateLocal(nowSec);
	const conditions: string[] = ["date_local = ?"];
	const params: unknown[] = [dateLocal];
	if (pathKindFilter) {
		conditions.push("path_kind = ?");
		params.push(pathKindFilter);
	}
	const where = conditions.join(" AND ");
	const offset = (page - 1) * limit;

	// Count of distinct (path_kind, target_id) tuples in the filtered
	// slice — this is the pagination total. We use a subselect so the
	// per-row aggregation in the list query stays simple.
	const totalSql = `SELECT COUNT(*) AS total FROM (
		SELECT 1 FROM analytics_daily_targets
		WHERE ${where}
		GROUP BY path_kind, target_id
	)`;
	const listSql = `SELECT
		path_kind AS path_kind,
		target_id AS target_id,
		COALESCE(SUM(count), 0) AS views,
		COALESCE(SUM(CASE WHEN bot_class = 'human'      THEN count ELSE 0 END), 0) AS human_views,
		COALESCE(SUM(CASE WHEN bot_class = 'bot_search' THEN count ELSE 0 END), 0) AS bot_search_views,
		COALESCE(SUM(CASE WHEN bot_class = 'bot_other'  THEN count ELSE 0 END), 0) AS bot_other_views,
		COALESCE(SUM(CASE WHEN bot_class = 'unknown'    THEN count ELSE 0 END), 0) AS unknown_views,
		COUNT(DISTINCT CASE WHEN user_id > 0 THEN user_id END) AS unique_users,
		MIN(first_seen_at) AS first_seen_at,
		MAX(last_seen_at)  AS last_seen_at
		FROM analytics_daily_targets
		WHERE ${where}
		GROUP BY path_kind, target_id
		ORDER BY views DESC, last_seen_at DESC, path_kind ASC, target_id ASC
		LIMIT ? OFFSET ?`;

	const [countRow, listResult] = await Promise.all([
		env.DB.prepare(totalSql)
			.bind(...params)
			.first<{ total: number }>(),
		env.DB.prepare(listSql)
			.bind(...params, limit, offset)
			.all<{
				path_kind: string;
				target_id: number;
				views: number;
				human_views: number;
				bot_search_views: number;
				bot_other_views: number;
				unknown_views: number;
				unique_users: number;
				first_seen_at: number;
				last_seen_at: number;
			}>(),
	]);

	const raw = listResult.results ?? [];
	const labels = await resolveLabels(env, raw);
	const rows: TodayVisitsListRow[] = raw.map((r) => ({
		pathKind: r.path_kind as PathKind,
		targetId: r.target_id,
		label: labels.get(`${r.path_kind}#${r.target_id}`) ?? "",
		views: Number(r.views ?? 0),
		humanViews: Number(r.human_views ?? 0),
		botSearchViews: Number(r.bot_search_views ?? 0),
		botOtherViews: Number(r.bot_other_views ?? 0),
		unknownViews: Number(r.unknown_views ?? 0),
		uniqueUsers: Number(r.unique_users ?? 0),
		firstSeenAt: Number(r.first_seen_at ?? 0),
		lastSeenAt: Number(r.last_seen_at ?? 0),
	}));

	return { total: countRow?.total ?? 0, rows };
}

/**
 * Batch-resolve display labels for the page's rows. Only `thread`,
 * `forum`, and `user` carry a target-bound label; all other path_kinds
 * have a fixed UI label and an empty string here. We issue at most one
 * query per source table per page, regardless of row count, so a page
 * of 100 thread visits stays O(1) round-trips.
 *
 * Returns `Map<"path_kind#target_id", label>`.
 */
async function resolveLabels(
	env: Env,
	rows: Array<{ path_kind: string; target_id: number }>,
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (rows.length === 0) return out;

	const threadIds = new Set<number>();
	const forumIds = new Set<number>();
	const userIds = new Set<number>();
	for (const r of rows) {
		if (r.target_id <= 0) continue;
		if (r.path_kind === "thread") threadIds.add(r.target_id);
		else if (r.path_kind === "forum") forumIds.add(r.target_id);
		else if (r.path_kind === "user") userIds.add(r.target_id);
	}

	const promises: Promise<void>[] = [];
	if (threadIds.size > 0) {
		const ids = [...threadIds];
		const placeholders = ids.map(() => "?").join(",");
		promises.push(
			env.DB.prepare(`SELECT id, subject FROM threads WHERE id IN (${placeholders})`)
				.bind(...ids)
				.all<{ id: number; subject: string }>()
				.then((rs) => {
					for (const t of rs.results ?? []) out.set(`thread#${t.id}`, t.subject ?? "");
				}),
		);
	}
	if (forumIds.size > 0) {
		const ids = [...forumIds];
		const placeholders = ids.map(() => "?").join(",");
		promises.push(
			env.DB.prepare(`SELECT id, name FROM forums WHERE id IN (${placeholders})`)
				.bind(...ids)
				.all<{ id: number; name: string }>()
				.then((rs) => {
					for (const f of rs.results ?? []) out.set(`forum#${f.id}`, f.name ?? "");
				}),
		);
	}
	if (userIds.size > 0) {
		const ids = [...userIds];
		const placeholders = ids.map(() => "?").join(",");
		promises.push(
			env.DB.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
				.bind(...ids)
				.all<{ id: number; username: string }>()
				.then((rs) => {
					for (const u of rs.results ?? []) out.set(`user#${u.id}`, u.username ?? "");
				}),
		);
	}

	await Promise.all(promises);
	return out;
}

// ─── Handlers ────────────────────────────────────────────────────

/** GET /api/admin/analytics/today/visits — KPI card (KV-cached). */
async function kpiHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const nowSec = Math.floor(Date.now() / 1000);
	let payload: TodayVisitsKpi;
	if (!ctx) {
		payload = await loadKpi(env, nowSec);
	} else {
		payload = await cacheGetOrSet<TodayVisitsKpi>(
			env,
			ctx,
			KPI_KV_KEY,
			() => loadKpi(env, nowSec),
			{ ttl: KPI_TTL_SEC, validator: isTodayVisitsKpi, family: KPI_FAMILY },
		);
	}
	return jsonResponse(payload, origin);
}

/** GET /api/admin/analytics/today/visits/list — realtime, no-store. */
async function listHandler(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	let pathKindFilter: PathKind | null = null;
	const pathKindParam = url.searchParams.get("path_kind");
	if (pathKindParam !== null && pathKindParam !== "") {
		if (!PATH_KIND_VALUES.has(pathKindParam as PathKind)) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "Unknown path_kind", allowed: [...PATH_KIND_VALUES] },
				origin,
			);
		}
		pathKindFilter = pathKindParam as PathKind;
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

	const nowSec = Math.floor(Date.now() / 1000);
	const { total, rows } = await loadListPage(env, nowSec, pathKindFilter, page, limit);

	return jsonNoStoreResponse({ page, limit, total, rows }, origin);
}

// ─── Exports (router wires by name) ─────────────────────────────

export const getTodayVisitsKpi = withEntityAuth(todayVisitsConfig, kpiHandler);
export const getTodayVisitsList = withEntityAuth(todayVisitsConfig, listHandler);

// Pure helpers — exported for unit tests only. Production code MUST
// route through the auth-wrapped exports above.
export const _internal = {
	shanghaiDateLocal,
	loadKpi,
	loadListPage,
	resolveLabels,
	isTodayVisitsKpi,
	todayVisitsConfig,
	KPI_KV_KEY,
	KPI_FAMILY,
	KPI_TTL_SEC,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_DEFAULT,
	PATH_KIND_VALUES,
};

// Admin analytics handlers — query-only dashboard endpoints (P2).
//
// All four endpoints are pure aggregation over existing source-of-truth
// business tables (`users`, `threads`, `posts`, `checkin_history`). No
// writes; no instrumented events yet. The trend queries rely on the
// time-leading indexes added in migration 0041 — see
// `0041_idx_analytics_trend.sql` for rationale and drift guard.
//
// Time-bucketing rule: every "day" boundary is **Asia/Shanghai local
// midnight** (UTC+8, fixed offset, no DST). The forum is operated in
// CST so admins expect "今天" to mean local-midnight-to-now, not
// UTC-midnight-to-now. For sources that store a unix-second
// `created_at` (`users.reg_date`, `threads.created_at`,
// `posts.created_at`) we resolve buckets in SQL via the offset:
//
//   day_local = (created_at + 8*3600) / 86400  (integer division)
//
// which is the SQLite-friendly way to express `strftime('%Y-%m-%d',
// datetime(created_at, 'unixepoch', '+8 hours'))` while keeping the
// numeric range scan cheap. The handler then formats each day key as
// `YYYY-MM-DD` for the UI.
//
// Checkin endpoints are an exception: `checkin_history` already
// carries a canonical Shanghai-local `date_local` TEXT column
// (YYYY-MM-DD, migration 0036) with a dedicated index
// `idx_checkin_history_date`. Overview's "今日签到" and the checkin
// trend therefore query `WHERE date_local = ?` / `WHERE date_local >=
// ? AND date_local <= ?` directly — they MUST NOT fall back to
// `created_at`, which is a Shanghai-noon stamp that drifts from the
// write-side day-key semantics and bypasses the existing index.
//
// KV cache: every endpoint goes through `cacheGetOrSet` with an
// endpoint-scoped family registered in `kv-registry.ts`. TTLs are
// conservative (60s overview, 300s the rest) — the dashboard is read
// often but tolerates stale-by-minutes data. Validators guard against
// shape drift after a code change ships against pre-existing KV
// payloads.

import { withEntityAuth } from "../../lib/adminHelpers";
import { cacheGetOrSet } from "../../lib/cache/wrap";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

// ─── Constants ───────────────────────────────────────────────────

/** Local-midnight offset in seconds (Asia/Shanghai, fixed UTC+8). */
const LOCAL_TZ_OFFSET_SEC = 8 * 3600;
const SEC_PER_DAY = 86_400;

/** Allowed range tokens for trend / forum-dist / checkin endpoints. */
const ALLOWED_RANGES = ["7d", "30d", "90d"] as const;
type Range = (typeof ALLOWED_RANGES)[number];

const ALLOWED_METRICS = ["users", "threads", "posts", "checkins"] as const;
type TrendMetric = (typeof ALLOWED_METRICS)[number];

/** TTLs — pinned to KV registry. Drift caught by `kv-registry.test.ts`. */
const OVERVIEW_TTL_SEC = 60;
const TREND_TTL_SEC = 300;
const FORUM_DIST_TTL_SEC = 300;
const CHECKIN_TTL_SEC = 300;

/** Forum-dist row cap — avoid sending hundreds of low-traffic forums. */
const FORUM_DIST_LIMIT = 50;

// ─── Auth wrapper (matches statistics.ts pattern) ───────────────

const analyticsConfig: EntityConfig = {
	table: "",
	entityName: "ANALYTICS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

// ─── Helpers ─────────────────────────────────────────────────────

function rangeDays(range: Range): number {
	if (range === "7d") return 7;
	if (range === "30d") return 30;
	return 90;
}

function parseRange(url: URL): Range | null {
	const raw = url.searchParams.get("range") ?? "7d";
	return (ALLOWED_RANGES as readonly string[]).includes(raw) ? (raw as Range) : null;
}

function parseMetric(url: URL): TrendMetric | null {
	const raw = url.searchParams.get("metric") ?? "users";
	return (ALLOWED_METRICS as readonly string[]).includes(raw) ? (raw as TrendMetric) : null;
}

/** Local-midnight Unix-seconds for "today" relative to `now`. */
function localTodayStart(now: number): number {
	return Math.floor((now + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY) * SEC_PER_DAY - LOCAL_TZ_OFFSET_SEC;
}

/** Convert a `day_local` integer back to "YYYY-MM-DD" (UTC+8 calendar). */
function dayLocalToIso(dayLocal: number): string {
	// dayLocal counts days since 1970-01-01 in UTC+8 timezone.
	const ms = dayLocal * SEC_PER_DAY * 1000 - LOCAL_TZ_OFFSET_SEC * 1000;
	const d = new Date(ms + LOCAL_TZ_OFFSET_SEC * 1000);
	const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
	const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
	const dd = d.getUTCDate().toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

/** "Today" as `YYYY-MM-DD` in Asia/Shanghai. Canonical form of `checkin_history.date_local`. */
function localTodayIso(nowSec: number): string {
	const todayStart = localTodayStart(nowSec);
	const todayLocal = Math.floor((todayStart + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY);
	return dayLocalToIso(todayLocal);
}

/**
 * Fill missing days in a `[start, end)` range with `count=0`. Charts
 * draw a continuous x-axis even when no events landed on a given day.
 *
 * `rows` is sorted ascending by `day_local`. `nowSec` provides the
 * "today" anchor so range windows are stable across cache TTL.
 */
function fillDaily(
	rows: Array<{ day_local: number; count: number }>,
	days: number,
	nowSec: number,
): Array<{ date: string; count: number }> {
	const todayStart = localTodayStart(nowSec);
	const todayLocal = Math.floor((todayStart + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY);
	const firstLocal = todayLocal - (days - 1);
	const byDay = new Map<number, number>();
	for (const r of rows) byDay.set(r.day_local, r.count);

	const out: Array<{ date: string; count: number }> = [];
	for (let d = firstLocal; d <= todayLocal; d++) {
		out.push({ date: dayLocalToIso(d), count: byDay.get(d) ?? 0 });
	}
	return out;
}

/**
 * Variant of `fillDaily` for sources that already store YYYY-MM-DD
 * canonical day keys (e.g. `checkin_history.date_local`). Avoids the
 * round-trip through the `day_local` integer math.
 */
function fillDailyByIso(
	rows: Array<{ date_local: string; count: number }>,
	days: number,
	nowSec: number,
): Array<{ date: string; count: number }> {
	const todayStart = localTodayStart(nowSec);
	const todayLocal = Math.floor((todayStart + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY);
	const firstLocal = todayLocal - (days - 1);
	const byDay = new Map<string, number>();
	for (const r of rows) byDay.set(r.date_local, r.count);

	const out: Array<{ date: string; count: number }> = [];
	for (let d = firstLocal; d <= todayLocal; d++) {
		const iso = dayLocalToIso(d);
		out.push({ date: iso, count: byDay.get(iso) ?? 0 });
	}
	return out;
}

// ─── Validators ──────────────────────────────────────────────────
//
// Each `cacheGetOrSet` payload is shape-validated on read; a schema
// drift after a code change ships against pre-existing KV entries
// would otherwise silently feed the UI stale-shape data.

interface OverviewPayload {
	now: number;
	today: {
		newUsers: number;
		newThreads: number;
		newPosts: number;
		checkins: number;
	};
}

function isOverviewPayload(v: unknown): v is OverviewPayload {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	if (typeof o.now !== "number") return false;
	const t = o.today as Record<string, unknown> | undefined;
	if (!t || typeof t !== "object") return false;
	return (
		typeof t.newUsers === "number" &&
		typeof t.newThreads === "number" &&
		typeof t.newPosts === "number" &&
		typeof t.checkins === "number"
	);
}

interface TrendPayload {
	metric: TrendMetric;
	range: Range;
	series: Array<{ date: string; count: number }>;
}

function isTrendPayload(v: unknown): v is TrendPayload {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	if (!(ALLOWED_METRICS as readonly string[]).includes(o.metric as string)) return false;
	if (!(ALLOWED_RANGES as readonly string[]).includes(o.range as string)) return false;
	if (!Array.isArray(o.series)) return false;
	return o.series.every(
		(p) =>
			p &&
			typeof p === "object" &&
			typeof (p as Record<string, unknown>).date === "string" &&
			typeof (p as Record<string, unknown>).count === "number",
	);
}

interface ForumDistPayload {
	range: Range;
	rows: Array<{ forumId: number; forumName: string; posts: number }>;
}

function isForumDistPayload(v: unknown): v is ForumDistPayload {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	if (!(ALLOWED_RANGES as readonly string[]).includes(o.range as string)) return false;
	if (!Array.isArray(o.rows)) return false;
	return o.rows.every((r) => {
		if (!r || typeof r !== "object") return false;
		const x = r as Record<string, unknown>;
		return (
			typeof x.forumId === "number" &&
			typeof x.forumName === "string" &&
			typeof x.posts === "number"
		);
	});
}

interface CheckinPayload {
	range: Range;
	series: Array<{ date: string; count: number }>;
}

function isCheckinPayload(v: unknown): v is CheckinPayload {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	if (!(ALLOWED_RANGES as readonly string[]).includes(o.range as string)) return false;
	if (!Array.isArray(o.series)) return false;
	return o.series.every(
		(p) =>
			p &&
			typeof p === "object" &&
			typeof (p as Record<string, unknown>).date === "string" &&
			typeof (p as Record<string, unknown>).count === "number",
	);
}

// ─── Queries ─────────────────────────────────────────────────────

/**
 * "Today" KPI counts. Local-midnight is computed in code and bound as
 * the WHERE filter so the planner can pick the time-leading indexes
 * (`idx_users_reg_date`, `idx_threads_created`, `idx_posts_created`).
 *
 * Checkin uses `checkin_history.date_local` (TEXT YYYY-MM-DD canonical
 * day-key, see migration 0036) so it hits `idx_checkin_history_date`
 * and stays semantically aligned with the Shanghai day-key used by the
 * checkin write path.
 */
async function loadOverview(env: Env, nowSec: number): Promise<OverviewPayload> {
	const todayStart = localTodayStart(nowSec);
	const todayIso = localTodayIso(nowSec);
	const results = await env.DB.batch([
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users WHERE reg_date >= ?").bind(todayStart),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads WHERE created_at >= ?").bind(todayStart),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ?").bind(todayStart),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM checkin_history WHERE date_local = ?").bind(
			todayIso,
		),
	]);
	const get = (i: number) => (results[i].results[0] as Record<string, number>).cnt;
	return {
		now: nowSec,
		today: {
			newUsers: get(0),
			newThreads: get(1),
			newPosts: get(2),
			checkins: get(3),
		},
	};
}

/**
 * Trend series. The SQL has a single shape per metric: group by the
 * `day_local` derived column, restrict to the window via the time
 * column, then bucket-sort by day_local. Per metric:
 *
 *   - users:    uses `idx_users_reg_date`        (reg_date)
 *   - threads:  uses `idx_threads_created`       (created_at DESC)
 *   - posts:    uses `idx_posts_created`         (created_at DESC)
 *   - checkins: uses `idx_checkin_history_date`  (date_local) — queries
 *               by the canonical TEXT day key, not `created_at`, so it
 *               matches the existing index and the Shanghai day-key
 *               write-side semantics from migration 0036.
 *
 * The derived-column expression `(time + 28800) / 86400` is identical
 * across the three business metrics so the planner sees a single
 * shape — cheaper to validate in unit tests too.
 */
async function loadTrend(env: Env, nowSec: number, metric: TrendMetric, range: Range) {
	const days = rangeDays(range);
	const windowStart = localTodayStart(nowSec) - (days - 1) * SEC_PER_DAY;

	if (metric === "checkins") {
		// `checkin_history.date_local` is the canonical YYYY-MM-DD day
		// key (Shanghai). Range bounds are inclusive on both ends.
		const todayIso = localTodayIso(nowSec);
		const todayLocal = Math.floor((localTodayStart(nowSec) + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY);
		const startIso = dayLocalToIso(todayLocal - (days - 1));
		const sql = `
			SELECT date_local AS date_local,
			       COUNT(*) AS count
			FROM checkin_history
			WHERE date_local >= ? AND date_local <= ?
			GROUP BY date_local
			ORDER BY date_local ASC
		`;
		const rs = await env.DB.prepare(sql).bind(startIso, todayIso).all();
		const rows = (rs.results as Array<{ date_local: string; count: number }>) ?? [];
		return { metric, range, series: fillDailyByIso(rows, days, nowSec) } satisfies TrendPayload;
	}

	let sql: string;
	if (metric === "users") {
		sql = `
			SELECT ((reg_date + ${LOCAL_TZ_OFFSET_SEC}) / ${SEC_PER_DAY}) AS day_local,
			       COUNT(*) AS count
			FROM users
			WHERE reg_date >= ?
			GROUP BY day_local
			ORDER BY day_local ASC
		`;
	} else if (metric === "threads") {
		sql = `
			SELECT ((created_at + ${LOCAL_TZ_OFFSET_SEC}) / ${SEC_PER_DAY}) AS day_local,
			       COUNT(*) AS count
			FROM threads
			WHERE created_at >= ?
			GROUP BY day_local
			ORDER BY day_local ASC
		`;
	} else {
		// posts
		sql = `
			SELECT ((created_at + ${LOCAL_TZ_OFFSET_SEC}) / ${SEC_PER_DAY}) AS day_local,
			       COUNT(*) AS count
			FROM posts
			WHERE created_at >= ?
			GROUP BY day_local
			ORDER BY day_local ASC
		`;
	}

	const rs = await env.DB.prepare(sql).bind(windowStart).all();
	const rows = (rs.results as Array<{ day_local: number; count: number }>) ?? [];
	const series = fillDaily(rows, days, nowSec);
	return { metric, range, series } satisfies TrendPayload;
}

/**
 * Per-forum post distribution within the window. The leading index
 * (`idx_posts_forum_created` — forum_id leading) lets the planner do a
 * forum-grouped time-range scan without a full table scan.
 *
 * Rows are restricted to forums with `forums.status >= 0` (i.e.
 * non-deleted; `1` is visible, `0` is hidden, negative values are
 * tombstoned/deleted forums per migration-0000 convention). We keep
 * the LEFT JOIN so a post that lost its forum row still aggregates
 * under an empty name, but we apply the status filter via
 * `COALESCE(f.status, -1) >= 0` so a missing forum row trips the
 * filter and is dropped from the distribution — admins should not see
 * tombstoned forums in the chart. We do NOT apply the per-user
 * `visibility` ACL here because all admin users can see the whole
 * tree.
 *
 * Cap at top-N (`FORUM_DIST_LIMIT`) sorted by posts DESC. The chart
 * UI can scroll; the API limit keeps the payload bounded and the
 * planner's GROUP BY work small.
 */
async function loadForumDist(env: Env, nowSec: number, range: Range): Promise<ForumDistPayload> {
	const days = rangeDays(range);
	const windowStart = localTodayStart(nowSec) - (days - 1) * SEC_PER_DAY;
	const sql = `
		SELECT p.forum_id  AS forum_id,
		       COALESCE(f.name, '') AS forum_name,
		       COUNT(*)    AS posts
		FROM posts p
		LEFT JOIN forums f ON f.id = p.forum_id
		WHERE p.created_at >= ?
		  AND COALESCE(f.status, -1) >= 0
		GROUP BY p.forum_id
		ORDER BY posts DESC, p.forum_id ASC
		LIMIT ?
	`;
	const rs = await env.DB.prepare(sql).bind(windowStart, FORUM_DIST_LIMIT).all();
	const raw = (rs.results as Array<{ forum_id: number; forum_name: string; posts: number }>) ?? [];
	return {
		range,
		rows: raw.map((r) => ({
			forumId: r.forum_id,
			forumName: r.forum_name,
			posts: r.posts,
		})),
	};
}

async function loadCheckinTrend(env: Env, nowSec: number, range: Range): Promise<CheckinPayload> {
	const days = rangeDays(range);
	// `checkin_history.date_local` is the canonical YYYY-MM-DD day key
	// (Shanghai, see migration 0036). Querying it directly hits
	// `idx_checkin_history_date` and matches the write-side semantics
	// used by the checkin handler.
	const todayIso = localTodayIso(nowSec);
	const todayLocal = Math.floor((localTodayStart(nowSec) + LOCAL_TZ_OFFSET_SEC) / SEC_PER_DAY);
	const startIso = dayLocalToIso(todayLocal - (days - 1));
	const sql = `
		SELECT date_local AS date_local,
		       COUNT(*) AS count
		FROM checkin_history
		WHERE date_local >= ? AND date_local <= ?
		GROUP BY date_local
		ORDER BY date_local ASC
	`;
	const rs = await env.DB.prepare(sql).bind(startIso, todayIso).all();
	const rows = (rs.results as Array<{ date_local: string; count: number }>) ?? [];
	return { range, series: fillDailyByIso(rows, days, nowSec) };
}

// ─── Handlers ────────────────────────────────────────────────────

async function overviewHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	if (!ctx) {
		// Defensive: every admin endpoint is called with ctx by the router.
		// Without it `cacheGetOrSet` cannot schedule the KV write-back, so
		// we fall back to a direct loader call (no cache).
		const payload = await loadOverview(env, Math.floor(Date.now() / 1000));
		return jsonResponse(payload, origin);
	}
	const nowSec = Math.floor(Date.now() / 1000);
	const payload = await cacheGetOrSet<OverviewPayload>(
		env,
		ctx,
		"analytics:overview",
		() => loadOverview(env, nowSec),
		{ ttl: OVERVIEW_TTL_SEC, validator: isOverviewPayload, family: "analytics:overview" },
	);
	return jsonResponse(payload, origin);
}

async function trendHandler(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const metric = parseMetric(url);
	const range = parseRange(url);
	if (!metric) {
		return errorResponse("INVALID_METRIC", 400, { allowed: [...ALLOWED_METRICS] }, origin);
	}
	if (!range) {
		return errorResponse("INVALID_RANGE", 400, { allowed: [...ALLOWED_RANGES] }, origin);
	}
	const nowSec = Math.floor(Date.now() / 1000);
	if (!ctx) {
		const payload = await loadTrend(env, nowSec, metric, range);
		return jsonResponse(payload, origin);
	}
	const key = `analytics:trend:${metric}:${range}`;
	const payload = await cacheGetOrSet<TrendPayload>(
		env,
		ctx,
		key,
		() => loadTrend(env, nowSec, metric, range),
		{ ttl: TREND_TTL_SEC, validator: isTrendPayload, family: "analytics:trend" },
	);
	return jsonResponse(payload, origin);
}

async function forumDistHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const range = parseRange(url);
	if (!range) {
		return errorResponse("INVALID_RANGE", 400, { allowed: [...ALLOWED_RANGES] }, origin);
	}
	const nowSec = Math.floor(Date.now() / 1000);
	if (!ctx) {
		const payload = await loadForumDist(env, nowSec, range);
		return jsonResponse(payload, origin);
	}
	const key = `analytics:forum-dist:${range}`;
	const payload = await cacheGetOrSet<ForumDistPayload>(
		env,
		ctx,
		key,
		() => loadForumDist(env, nowSec, range),
		{ ttl: FORUM_DIST_TTL_SEC, validator: isForumDistPayload, family: "analytics:forum-dist" },
	);
	return jsonResponse(payload, origin);
}

async function checkinHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const range = parseRange(url);
	if (!range) {
		return errorResponse("INVALID_RANGE", 400, { allowed: [...ALLOWED_RANGES] }, origin);
	}
	const nowSec = Math.floor(Date.now() / 1000);
	if (!ctx) {
		const payload = await loadCheckinTrend(env, nowSec, range);
		return jsonResponse(payload, origin);
	}
	const key = `analytics:checkin:${range}`;
	const payload = await cacheGetOrSet<CheckinPayload>(
		env,
		ctx,
		key,
		() => loadCheckinTrend(env, nowSec, range),
		{ ttl: CHECKIN_TTL_SEC, validator: isCheckinPayload, family: "analytics:checkin" },
	);
	return jsonResponse(payload, origin);
}

export const getOverview = withEntityAuth(analyticsConfig, overviewHandler);
export const getTrend = withEntityAuth(analyticsConfig, trendHandler);
export const getForumDist = withEntityAuth(analyticsConfig, forumDistHandler);
export const getCheckinTrend = withEntityAuth(analyticsConfig, checkinHandler);

// Exported for unit tests — pure helpers, no side effects.
export const _internal = {
	localTodayStart,
	localTodayIso,
	dayLocalToIso,
	fillDaily,
	fillDailyByIso,
	loadOverview,
	loadTrend,
	loadForumDist,
	loadCheckinTrend,
	OVERVIEW_TTL_SEC,
	TREND_TTL_SEC,
	FORUM_DIST_TTL_SEC,
	CHECKIN_TTL_SEC,
	ALLOWED_METRICS,
	ALLOWED_RANGES,
	FORUM_DIST_LIMIT,
};

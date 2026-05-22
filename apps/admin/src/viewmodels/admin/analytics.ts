/**
 * Admin analytics — client-safe types and parsers (P2).
 *
 * The shape mirrors the worker handler `handlers/admin/analytics.ts`.
 * Parsers default missing fields to zero/empty so a partial / stale
 * payload still renders.
 */

export const ANALYTICS_RANGES = ["7d", "30d", "90d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_TREND_METRICS = ["users", "threads", "posts", "checkins"] as const;
export type AnalyticsTrendMetric = (typeof ANALYTICS_TREND_METRICS)[number];

export interface AnalyticsOverview {
	now: number;
	today: {
		newUsers: number;
		newThreads: number;
		newPosts: number;
		checkins: number;
	};
}

export interface AnalyticsTrendPoint {
	date: string;
	count: number;
}

export interface AnalyticsTrend {
	metric: AnalyticsTrendMetric;
	range: AnalyticsRange;
	series: AnalyticsTrendPoint[];
}

export interface AnalyticsForumDistRow {
	forumId: number;
	forumName: string;
	posts: number;
}

export interface AnalyticsForumDist {
	range: AnalyticsRange;
	rows: AnalyticsForumDistRow[];
}

export interface AnalyticsCheckinTrend {
	range: AnalyticsRange;
	series: AnalyticsTrendPoint[];
}

// ---------------------------------------------------------------------------
// Parsers (defensive — tolerate missing fields)
// ---------------------------------------------------------------------------

function asNumber(v: unknown, fallback = 0): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ""): string {
	return typeof v === "string" ? v : fallback;
}

function isRange(v: unknown): v is AnalyticsRange {
	return typeof v === "string" && (ANALYTICS_RANGES as readonly string[]).includes(v);
}

function isMetric(v: unknown): v is AnalyticsTrendMetric {
	return typeof v === "string" && (ANALYTICS_TREND_METRICS as readonly string[]).includes(v);
}

export function parseOverview(raw: unknown): AnalyticsOverview {
	const o = (raw ?? {}) as Record<string, unknown>;
	const t = (o.today ?? {}) as Record<string, unknown>;
	return {
		now: asNumber(o.now),
		today: {
			newUsers: asNumber(t.newUsers),
			newThreads: asNumber(t.newThreads),
			newPosts: asNumber(t.newPosts),
			checkins: asNumber(t.checkins),
		},
	};
}

function parseSeries(raw: unknown): AnalyticsTrendPoint[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((p) => {
		const x = (p ?? {}) as Record<string, unknown>;
		return { date: asString(x.date), count: asNumber(x.count) };
	});
}

export function parseTrend(
	raw: unknown,
	fallback: AnalyticsTrendMetric,
	range: AnalyticsRange,
): AnalyticsTrend {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		metric: isMetric(o.metric) ? o.metric : fallback,
		range: isRange(o.range) ? o.range : range,
		series: parseSeries(o.series),
	};
}

export function parseForumDist(raw: unknown, range: AnalyticsRange): AnalyticsForumDist {
	const o = (raw ?? {}) as Record<string, unknown>;
	const rows = Array.isArray(o.rows) ? o.rows : [];
	return {
		range: isRange(o.range) ? o.range : range,
		rows: rows.map((r) => {
			const x = (r ?? {}) as Record<string, unknown>;
			return {
				forumId: asNumber(x.forumId),
				forumName: asString(x.forumName),
				posts: asNumber(x.posts),
			};
		}),
	};
}

export function parseCheckinTrend(raw: unknown, range: AnalyticsRange): AnalyticsCheckinTrend {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		range: isRange(o.range) ? o.range : range,
		series: parseSeries(o.series),
	};
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const METRIC_LABELS: Record<AnalyticsTrendMetric, string> = {
	users: "新注册",
	threads: "新主题",
	posts: "新回复",
	checkins: "签到",
};

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
	"7d": "近 7 天",
	"30d": "近 30 天",
	"90d": "近 90 天",
};

// ---------------------------------------------------------------------------
// Login-history (P4) — types + parsers
// ---------------------------------------------------------------------------

/**
 * KPI card payload from GET /api/admin/analytics/today/logins.
 * Aggregate-only — the response body is KV-cached on the worker (60s)
 * with NO ip / ua / username. Field shapes mirror the worker handler.
 */
export interface TodayLoginsKpi {
	now: number;
	dayStart: number;
	totalAttempts: number;
	successAttempts: number;
	failedAttempts: number;
	uniqueUsers: number;
	uniqueIps: number;
	loginAttempts: number;
	registerAttempts: number;
}

export function parseTodayLoginsKpi(raw: unknown): TodayLoginsKpi {
	const o = (raw ?? {}) as Record<string, unknown>;
	return {
		now: asNumber(o.now),
		dayStart: asNumber(o.dayStart),
		totalAttempts: asNumber(o.totalAttempts),
		successAttempts: asNumber(o.successAttempts),
		failedAttempts: asNumber(o.failedAttempts),
		uniqueUsers: asNumber(o.uniqueUsers),
		uniqueIps: asNumber(o.uniqueIps),
		loginAttempts: asNumber(o.loginAttempts),
		registerAttempts: asNumber(o.registerAttempts),
	};
}

/** Single row from GET /api/admin/analytics/today/logins/list. */
export interface LoginAttemptListRow {
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

export interface LoginAttemptList {
	page: number;
	limit: number;
	total: number;
	rows: LoginAttemptListRow[];
}

export function parseLoginAttemptList(raw: unknown): LoginAttemptList {
	const o = (raw ?? {}) as Record<string, unknown>;
	const rows = Array.isArray(o.rows) ? o.rows : [];
	return {
		page: asNumber(o.page, 1),
		limit: asNumber(o.limit, 20),
		total: asNumber(o.total),
		rows: rows.map((r) => {
			const x = (r ?? {}) as Record<string, unknown>;
			const okRaw = asNumber(x.ok);
			return {
				id: asNumber(x.id),
				userId:
					typeof x.userId === "number" && Number.isFinite(x.userId) ? (x.userId as number) : null,
				username: asString(x.username),
				ok: (okRaw === 1 ? 1 : 0) as 0 | 1,
				kind: asString(x.kind),
				errorCode: asString(x.errorCode),
				ip: asString(x.ip),
				userAgent: asString(x.userAgent),
				botClass: asString(x.botClass),
				createdAt: asNumber(x.createdAt),
			};
		}),
	};
}

// ---------------------------------------------------------------------------
// Today-visits (P5) — types + parsers
// ---------------------------------------------------------------------------

/**
 * Path-kind enum mirrors the worker's `PathKind`. The 10 buckets are
 * frozen by the strict body whitelist on
 * `/api/internal/analytics/ingest`; the admin UI uses the same set for
 * filter pills and for the list-row link routing rules.
 */
export const PATH_KIND_VALUES = [
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
] as const;
export type PathKind = (typeof PATH_KIND_VALUES)[number];

export function isPathKind(v: unknown): v is PathKind {
	return typeof v === "string" && (PATH_KIND_VALUES as readonly string[]).includes(v);
}

export const PATH_KIND_LABELS: Record<PathKind, string> = {
	thread: "主题",
	forum: "板块",
	user: "用户",
	home: "首页",
	digest: "精华",
	search: "搜索",
	checkin: "签到",
	messages: "私信",
	auth_page: "登录/注册",
	other: "其他",
};

export interface PathKindBreakdownEntry {
	pathKind: PathKind;
	views: number;
	targets: number;
}

/**
 * KPI card payload from GET /api/admin/analytics/today/visits.
 *
 * Aggregate-only — KV-cached on the worker (60s) with NO ip / ua /
 * username. The `activeUsers + anonPresent` sum is intentionally
 * labeled "活跃用户/访客（含匿名）" in the UI (reviewer pin); the
 * aggregate has NO per-session dedup, so we do NOT claim "独立访客".
 */
export interface TodayVisitsKpi {
	now: number;
	dateLocal: string;
	totalViews: number;
	humanViews: number;
	botSearchViews: number;
	botOtherViews: number;
	unknownViews: number;
	distinctTargets: number;
	activeUsers: number;
	/** 1 if any row has user_id = 0 (anonymous bucket), else 0. */
	anonPresent: 0 | 1;
	byPathKind: PathKindBreakdownEntry[];
}

export function parseTodayVisitsKpi(raw: unknown): TodayVisitsKpi {
	const o = (raw ?? {}) as Record<string, unknown>;
	const anonRaw = asNumber(o.anonPresent);
	const breakdownRaw = Array.isArray(o.byPathKind) ? o.byPathKind : [];
	const byPathKind: PathKindBreakdownEntry[] = [];
	for (const e of breakdownRaw) {
		const x = (e ?? {}) as Record<string, unknown>;
		if (isPathKind(x.pathKind)) {
			byPathKind.push({
				pathKind: x.pathKind,
				views: asNumber(x.views),
				targets: asNumber(x.targets),
			});
		}
	}
	return {
		now: asNumber(o.now),
		dateLocal: asString(o.dateLocal),
		totalViews: asNumber(o.totalViews),
		humanViews: asNumber(o.humanViews),
		botSearchViews: asNumber(o.botSearchViews),
		botOtherViews: asNumber(o.botOtherViews),
		unknownViews: asNumber(o.unknownViews),
		distinctTargets: asNumber(o.distinctTargets),
		activeUsers: asNumber(o.activeUsers),
		anonPresent: (anonRaw === 1 ? 1 : 0) as 0 | 1,
		byPathKind,
	};
}

/**
 * Per (path_kind, target_id) rollup row from
 * GET /api/admin/analytics/today/visits/list. Label is empty for
 * non-id-bearing buckets (home/digest/search/checkin/messages/...).
 */
export interface TodayVisitsListRow {
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

export interface TodayVisitsList {
	page: number;
	limit: number;
	total: number;
	rows: TodayVisitsListRow[];
}

export function parseTodayVisitsList(raw: unknown): TodayVisitsList {
	const o = (raw ?? {}) as Record<string, unknown>;
	const rows = Array.isArray(o.rows) ? o.rows : [];
	return {
		page: asNumber(o.page, 1),
		limit: asNumber(o.limit, 20),
		total: asNumber(o.total),
		rows: rows
			.map((r) => {
				const x = (r ?? {}) as Record<string, unknown>;
				if (!isPathKind(x.pathKind)) return null;
				return {
					pathKind: x.pathKind,
					targetId: asNumber(x.targetId),
					label: asString(x.label),
					views: asNumber(x.views),
					humanViews: asNumber(x.humanViews),
					botSearchViews: asNumber(x.botSearchViews),
					botOtherViews: asNumber(x.botOtherViews),
					unknownViews: asNumber(x.unknownViews),
					uniqueUsers: asNumber(x.uniqueUsers),
					firstSeenAt: asNumber(x.firstSeenAt),
					lastSeenAt: asNumber(x.lastSeenAt),
				} satisfies TodayVisitsListRow;
			})
			.filter((r): r is TodayVisitsListRow => r !== null),
	};
}

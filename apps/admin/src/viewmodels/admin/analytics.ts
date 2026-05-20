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

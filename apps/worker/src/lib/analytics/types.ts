// Analytics collector public types (P3, contract only).
//
// These types are the contract surface for the analytics pipeline:
//   ingest route (P-ingest) → recordPageView() → in-isolate bucket
//                          → scheduleFlush(env, ctx) → flushSink → D1 (P3.5)
//
// P3 ships ONLY the in-isolate aggregation + flush contract; the ingest
// route, the D1 sink, and the trust-edge (which headers / keys the
// ingest endpoint trusts) all land in later phases. Keeping the types
// minimal here lets the ingest PR import them without depending on any
// trust-edge / runtime concerns we haven't reviewed yet.

/**
 * Coarse classification of a User-Agent string. The collector does NOT
 * fingerprint or persist UAs — it only records which bucket each sample
 * fell into. Buckets are intentionally small and stable:
 *
 *   - `bot_search`: well-known search engine crawlers (Googlebot, Bingbot,
 *     Baiduspider, etc.). Counted separately so admins can distinguish
 *     "real users" from indexer traffic.
 *   - `bot_other`:  generic bot signature (`bot`, `spider`, `crawler`,
 *     `curl`, `wget`, headless tooling). Useful as a noise band.
 *   - `human`:      browser-shaped UA that did NOT match any bot pattern.
 *   - `unknown`:    empty / missing UA. We don't claim it's a bot — many
 *     legitimate clients (mobile webview, proxy) strip UAs.
 */
export type BotClass = "bot_search" | "bot_other" | "human" | "unknown";

/**
 * Coarse classification of the page URL. Computed by the ingest route,
 * NOT by the collector — the collector accepts whatever it's given.
 *
 * Pinned to the v3 proxy plan's page-bucket set so the ingest PR (P5)
 * can map the Next middleware matcher one-to-one without adding "other"
 * fallbacks for paths the plan already names. Each bucket corresponds
 * to a concrete route group in the source forum:
 *
 *   - `thread`:    `/threads/<id>` (post detail; numeric targetId)
 *   - `forum`:     `/forums/<id>` (board view; numeric targetId)
 *   - `user`:      `/users/<id>`  (profile; numeric targetId)
 *   - `home`:      `/` (front page; targetId=0)
 *   - `digest`:    `/digest` (精华区; targetId=0)
 *   - `search`:    `/search` (站内搜索; targetId=0)
 *   - `checkin`:   `/checkin` (签到页; targetId=0)
 *   - `messages`:  `/messages*` (站内信; targetId=0)
 *   - `auth_page`: `/login` / `/register` — kept SEPARATE from content
 *     visits so admins do not see login-form traffic mixed into
 *     forum-engagement metrics. The ingest route MUST classify
 *     these paths as `auth_page`, not `other`.
 *   - `other`:     any matched path that doesn't fall into the
 *     buckets above. Used as a small tail; the proxy plan excludes
 *     `_next`, `favicon.ico`, `/api`, and other static assets at
 *     the matcher level, so no `static` bucket is needed here.
 *     If the matcher ever needs to widen, prefer adding a named
 *     bucket over re-using `other`.
 */
export type PathKind =
	| "thread"
	| "forum"
	| "user"
	| "home"
	| "digest"
	| "search"
	| "checkin"
	| "messages"
	| "auth_page"
	| "other";

/**
 * One pre-resolved page view sample. The ingest route owns trust-edge
 * concerns (which header counts as the client IP, whether to honor a
 * forwarded user_id, etc.) and hands the collector a fully resolved
 * sample. The collector MUST NOT read headers, cookies, or any other
 * request-scoped trust signal — it operates purely on the values below.
 */
export interface PageViewSample {
	/** Asia/Shanghai local day in canonical `YYYY-MM-DD` form. */
	dateLocal: string;
	pathKind: PathKind;
	/** 0 for home / digest / search / checkin / auth_page / other / pages without a numeric target. */
	targetId: number;
	/** 0 for anonymous viewers. */
	userId: number;
	botClass: BotClass;
	/** Unix seconds. Used for first_seen / last_seen book-keeping. */
	ts: number;
}

/**
 * Aggregate row drained from the in-isolate bucket. One row per
 * (dateLocal, pathKind, targetId, userId, botClass) tuple — the same
 * primary key the future `analytics_daily_targets` table will use.
 *
 * This shape is the contract handed to `FlushSink` implementations; the
 * D1 implementation lands in a later phase.
 */
export interface AggregateRow {
	dateLocal: string;
	pathKind: PathKind;
	targetId: number;
	userId: number;
	botClass: BotClass;
	count: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

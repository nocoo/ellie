// Analytics collector public types.
//
// These types are the contract surface for the analytics pipeline,
// wired end-to-end as of P5:
//
//   ingest route (POST /api/internal/analytics/ingest)
//     → recordPageView()
//     → in-isolate bucket
//     → scheduleFlush(env, ctx)
//     → flushSink (D1 UPSERT into `analytics_daily_targets`)
//
// The collector itself is contract-only: it owns no trust-edge concerns
// and never reads request-scoped signals. Trust-edge ownership lives
// in the ingest route (`apps/worker/src/handlers/internal/analyticsIngest.ts`),
// and the production D1 sink is installed by `apps/worker/src/index.ts`
// via `setFlushSink(d1FlushSink)`. Keeping the types minimal here lets
// the ingest handler and the D1 sink import them without depending on
// each other's runtime concerns.

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
 *   - `other`:     a narrow tail used ONLY for explicitly known bucket
 *     fall-throughs — the bare container index pages of the id-bearing
 *     prefixes (`/threads`, `/forums`, `/users`) and known-prefix tails
 *     whose id is non-numeric (e.g. `/threads/new`, `/forums/foo`,
 *     `/users/abc`). **Unknown roots MUST NOT land here**: the Web
 *     proxy's `classifyPathKind` (`apps/web/src/proxy.ts`) is
 *     fail-closed for unknown roots (`/random`, future stray `/admin/*`
 *     proxied through the forum app, etc.) and returns `null` so no
 *     sample is emitted at all. Widening `other` would silently weaken
 *     the D0 v2 allowlist gate — prefer adding a named bucket instead.
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
 * primary key the `analytics_daily_targets` D1 table uses.
 *
 * This shape is the contract handed to `FlushSink` implementations;
 * the production D1 sink lives in `flushSink-d1.ts`.
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

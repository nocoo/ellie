import { CACHE_TTL_SECONDS, type CacheTier } from "@ellie/types";

// KV registry — single source of truth for every KV key family the
// Worker writes today, together with recognized legacy keys. Drives
// the admin "KV monitor" page so the UI can show:
//   - what is declared (status: shipped / planned / historical /
//     dead-builder-reserved)
//   - what is currently stored (count via KV.list per family prefix)
//   - what is missing / stale (count == 0 on a shipped family)
//   - what is sensitive (key NAME and VALUE have separate sensitivity
//     flags; see masking helpers in admin/kv.ts)
//
// The registry is also used by the architecture-guard test
// (`tests/unit/lib/cache/kv-registry.test.ts`) which keeps an allowlist
// of all `env.KV.put(...)` callsites in `apps/worker/src` and fails when
// a new prefix shows up that is not registered. This is a reminder, not
// a perfect static analysis; update the allowlist when you add a new
// KV write.
//
// CRITICAL: this file is data only. No `env`, no I/O, no imports from
// the runtime cache layer. Pure types + literals so it stays cheap to
// read from the admin UI and easy to unit-test.

export type KvCategory =
	| "cache" // read-through business cache (forum/thread/etc.)
	| "gen" // sticky generation token (epoch.ts)
	| "session" // refresh tokens, email verify
	| "rate-limit" // login/register/check-username/email lockouts
	| "stats" // public-stats, online_count
	| "sticky-stats" // online_peak (no TTL)
	| "throttle"; // activity_throttle, online presence marker

/**
 * Lifecycle of a key family.
 *
 * - `shipped`: at least one production code path writes this key today.
 * - `planned`: builder + helper wired but no live writer yet (waiting
 *   on a future phase). Registry entry exists so the UI can show
 *   "expected but absent" without flagging it as a regression.
 * - `historical`: previously-live family that has been cleaned up.
 *   Listed here only so leftover KV rows from old deployments are
 *   recognized in the UI.
 * - `dead-builder-reserved`: the key BUILDER exists in keys.ts but has
 *   no live caller; reserved for a future v2 schema migration. UI
 *   should not flag count==0 as a regression.
 */
export type KvStatus = "shipped" | "planned" | "historical" | "dead-builder-reserved";

/**
 * Sensitivity of the KEY NAME itself.
 *
 * - `public`: key name carries no secret material (numeric ids, fixed
 *   labels). Safe to show in sample lists.
 * - `mask`: key suffix encodes a user identifier or IP; UI must mask
 *   before display (see `maskKeyName` in admin/kv.ts).
 * - `hide`: key name itself is a credential (e.g. `refresh:<token>`).
 *   UI must never return sample keys for this family.
 */
export type KvNameSensitivity = "public" | "mask" | "hide";

/**
 * Sensitivity of the VALUE.
 *
 * - `public`: safe to return raw.
 * - `mask-value`: only return size + type + scrubbed shape (e.g. login
 *   counter integer is fine, but we still gate behind admin).
 * - `no-read`: handler MUST refuse to return the value at all
 *   (refresh tokens, email verification codes).
 */
export type KvValueSensitivity = "public" | "mask-value" | "no-read";

/**
 * Refresh / expire action exposed on the admin UI.
 *
 * Action `kind` is what the UI button does. The `requires` array names
 * extra parameters the UI must collect (forumId, exact key, …) — typed
 * so the front end cannot accidentally invent new variants.
 */
export type KvRefreshAction =
	| { kind: "bump-forum-tree" }
	| { kind: "bump-forum-summary" }
	| { kind: "bump-thread-list-all" }
	| { kind: "bump-thread-list-forum"; requires: ["forumId"] }
	| { kind: "bump-thread-meta"; requires: ["threadId"] }
	| { kind: "bump-post-list"; requires: ["threadId"] }
	| { kind: "bump-digest" }
	| { kind: "delete-literal"; requires: ["key"] }
	| { kind: "delete-user-mini"; requires: ["userId"] }
	| { kind: "none" };

/**
 * How `listPrefix` is interpreted when listing / resolving keys.
 *
 * - `prefix`: family owns all keys whose name `startsWith(listPrefix)`.
 *   This is the default for v2 cache families like `forum:tree:v2:`.
 * - `exact`: family owns exactly ONE literal key whose name equals
 *   `listPrefix`. This is required for singletons such as `settings:all`
 *   and `public-stats` so they don't accidentally swallow `settings:all:v2`
 *   etc.
 */
export type KvKeyKind = "prefix" | "exact";

export interface KvFamilySpec {
	/** Stable family identifier — used in API params and metrics rows. */
	family: string;
	/** Human-readable label for the admin UI. */
	displayName: string;
	category: KvCategory;
	status: KvStatus;
	/** Prefix passed to `KV.list({prefix})` to enumerate keys in this family. */
	listPrefix: string;
	/**
	 * Singleton vs prefix family. Defaults to `"prefix"` when unset.
	 * Singleton (`exact`) means this family is one literal key whose name
	 * equals `listPrefix` — used for `settings:all`, `public-stats`,
	 * `stats:online_count`, `stats:online_peak`, gen tokens like
	 * `forum:tree:gen`, and the global `thread:list:gen:all`.
	 */
	keyKind?: KvKeyKind;
	/** Human-readable expected key pattern — for UI tooltip only. */
	pattern: string;
	/**
	 * TTL in seconds. `"sticky"` means no TTL set (gen tokens, online_peak).
	 * `"variable"` means callers compute a TTL per write (e.g. email_verify
	 * `remaining`).
	 */
	ttl: number | "sticky" | "variable";
	/** Present only for enrolled business snapshots, never runtime state. */
	tier?: CacheTier;
	/** Static loader group; implementations stay outside this data-only registry. */
	loader?:
		| "reading"
		| "peripheral"
		| "forum"
		| "ip"
		| "admin"
		| "catalog"
		| "user"
		| "private"
		| "admin-report"
		| "monitor";
	nameSensitivity: KvNameSensitivity;
	valueSensitivity: KvValueSensitivity;
	refresh: KvRefreshAction;
	/**
	 * Names of the gen keys whose current value should be embedded into the
	 * "current" key pattern shown by the UI. Empty for non-gen-keyed
	 * families (literal TTL, session, rate-limit, stats).
	 */
	genKeys?: string[];
	description: string;
}

function businessFamily(
	family: string,
	displayName: string,
	tier: CacheTier,
	loader: NonNullable<KvFamilySpec["loader"]>,
	description: string,
	refresh: KvRefreshAction = { kind: "none" },
): KvFamilySpec {
	return {
		family,
		displayName,
		category: "cache",
		status: "shipped",
		listPrefix: `cache:v3:${family}:`,
		pattern: `cache:v3:${family}:<sha256>`,
		ttl: CACHE_TTL_SECONDS[tier],
		tier,
		loader,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh,
		description,
	};
}

/**
 * The canonical registry. Order shapes the UI section order: business
 * cache first, then gens, then auth/session/rate-limit, then stats,
 * then planned / dead-builder / historical at the bottom.
 *
 * NOTE on dead-builder-reserved entries (`settings:all:v2`,
 * `stats:public:v2`): the key builders exist in
 * `apps/worker/src/lib/cache/keys.ts` but have no live caller — they
 * are reserved for a future v2 schema migration. We list them here so
 * the UI does not flag count==0 as a regression, and so the
 * architecture-guard test does not need an extra allowlist for them.
 */
export const KV_REGISTRY: readonly KvFamilySpec[] = [
	businessFamily(
		"monitor:overview",
		"缓存运行概览",
		"MEDIUM",
		"monitor",
		"Bounded KV metadata observations; unknown or partial coverage remains explicit.",
	),
	businessFamily(
		"monitor:metrics:recent",
		"近期缓存与数据库趋势",
		"SHORT",
		"monitor",
		"Application minute metrics for windows up to 60 minutes; administrative traffic is separate.",
	),
	businessFamily(
		"monitor:metrics:history",
		"历史缓存与数据库趋势",
		"MEDIUM",
		"monitor",
		"Application trend windows beyond 60 minutes, without remote platform queries.",
	),
	...["user:self", "user:checkin", "user:posting-preview", "pm:list", "pm:entity", "pm:unread"].map(
		(family): KvFamilySpec => ({
			...businessFamily(
				family,
				family,
				"SHORT",
				"private",
				"Private display data scoped to the original user; fresh authentication/ownership checks before response. Preview is restricted; management never performs read/visit effects.",
			),
			...(["user:self", "user:checkin"].includes(family)
				? { listPrefix: `${family}:`, pattern: `${family}:<userId>` }
				: {}),
			valueSensitivity: "mask-value",
		}),
	),
	businessFamily(
		"admin:display",
		"后台查询展示",
		"SHORT",
		"admin-report",
		"Static normalized administrative displays; operation checks stay authoritative.",
	),
	{
		...businessFamily(
			"admin:analytics",
			"后台历史聚合",
			"MEDIUM",
			"admin-report",
			"Date-range aggregates; invalidated once after completed recalibration.",
		),
		genKeys: ["stats:reports:gen"],
	},
	...["admin:settings", "admin:users:staff", "admin:thread-types"].map((family) =>
		businessFamily(
			family,
			family,
			"SHORT",
			"admin",
			"Static administrative display; writes and authorization remain authoritative.",
		),
	),
	{
		family: "gen:pm:user",
		displayName: "Mailbox generation",
		category: "gen",
		status: "shipped",
		listPrefix: "pm:user:gen:",
		pattern: "pm:user:gen:<userId>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description: "Per-user mailbox mutations; no credential data.",
	},
	{
		family: "gen:stats:reports",
		displayName: "Report generation",
		category: "gen",
		status: "shipped",
		listPrefix: "stats:reports:gen",
		keyKind: "exact",
		pattern: "stats:reports:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description: "Changed only after completed statistics recalibration.",
	},
	{
		family: "gen:admin:entity",
		displayName: "Admin entity generation",
		category: "gen",
		status: "shipped",
		listPrefix: "admin:entity:gen:",
		pattern: "admin:entity:gen:<resource>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description: "Scoped administrative resource mutation epoch.",
	},

	businessFamily(
		"search:threads",
		"主题搜索",
		"SHORT",
		"catalog",
		"Normalized terms/cursors/limit and audience; membership only, current ACL gates before entity projection.",
	),
	businessFamily(
		"digest:list",
		"精华分页索引",
		"MEDIUM",
		"catalog",
		"All valid forum/year/level/cursor combinations with shared entities.",
	),
	{
		...businessFamily(
			"user:avatar-path",
			"头像路径映射",
			"LONG",
			"user",
			"Per-user avatar mapping; invalidated after replacement.",
		),
		listPrefix: "user:avatar-path:",
		pattern: "user:avatar-path:<id>",
	},
	businessFamily(
		"user:threads",
		"用户主题历史",
		"SHORT",
		"user",
		"All history cursors; current thread/forum and anonymous-author gates precede composition.",
	),
	businessFamily(
		"user:posts",
		"用户回复历史",
		"SHORT",
		"user",
		"Membership only; shared post/thread entities and current gates.",
	),
	businessFamily(
		"user:digest",
		"用户精华历史",
		"SHORT",
		"user",
		"All history cursors with the original viewer scope.",
	),
	businessFamily(
		"user:search",
		"用户搜索",
		"SHORT",
		"user",
		"Normalized prefix search; active users only.",
	),
	{
		...businessFamily(
			"user:stats",
			"用户动态统计",
			"SHORT",
			"user",
			"User counters and check-in display; actual writes validate current rows.",
		),
		listPrefix: "user:stats:",
		pattern: "user:stats:<id>",
	},
	businessFamily(
		"admin:entity:list",
		"后台实体列表",
		"SHORT",
		"admin",
		"Static admin entity configurations and normalized filters; Key B is checked on every request.",
	),
	businessFamily(
		"admin:entity:detail",
		"后台实体详情",
		"SHORT",
		"admin",
		"Admin field projections only; credentials excluded. Writes always validate current D1 state.",
	),
	businessFamily(
		"thread:entity",
		"主题稳定字段",
		"MEDIUM",
		"reading",
		"Internal raw entity; current thread/forum permission gates precede every response.",
		{ kind: "bump-thread-meta", requires: ["threadId"] },
	),
	businessFamily(
		"thread:stats",
		"主题动态统计",
		"SHORT",
		"reading",
		"Per-thread counters; ordinary views and replies use natural expiry.",
	),
	businessFamily(
		"thread:list",
		"主题分页、总数与公告索引",
		"SHORT",
		"reading",
		"Independent page memberships and per-forum/type totals; all normalized page/cursor/filter combinations and global announcements are shared without renewing dependencies.",
		{ kind: "bump-thread-list-forum", requires: ["forumId"] },
	),
	businessFamily(
		"post:entity",
		"回帖正文",
		"MEDIUM",
		"reading",
		"Internal raw post entity; current deletion and ownership gates precede response.",
	),
	businessFamily(
		"post:page",
		"回帖分页索引",
		"SHORT",
		"reading",
		"IDs and positions for all valid cursors and limits.",
		{ kind: "bump-post-list", requires: ["threadId"] },
	),
	businessFamily(
		"post:attachments",
		"附件元数据",
		"LONG",
		"reading",
		"Per-post attachment metadata; download authorization stays current.",
	),
	businessFamily(
		"post:comments",
		"帖子评论",
		"SHORT",
		"reading",
		"Per-post rows and limit; private IP fields are never stored.",
	),
	businessFamily(
		"post:ratings",
		"评分汇总",
		"SHORT",
		"reading",
		"Per-post aggregate; rating quotas use authoritative writes.",
	),
	businessFamily(
		"post:rating-rows",
		"评分明细",
		"SHORT",
		"reading",
		"Per-post active rating rows; response author projection stays request-scoped.",
	),
	...["digest:stats", "digest:filters", "recommended:threads"].map(
		(family): KvFamilySpec => ({
			family: `historical:${family}`,
			displayName: `${family} (legacy)`,
			category: "cache",
			status: "historical",
			listPrefix: `${family}:`,
			pattern: `${family}:<legacy>`,
			ttl: "variable",
			nameSensitivity: "public",
			valueSensitivity: "public",
			refresh: { kind: "none" },
			description: "Legacy raw payload; replaced by schema 3 membership and aggregate snapshots.",
		}),
	),
	...["post:entity", "post:attachments", "recommended"].map(
		(family): KvFamilySpec => ({
			family: `gen:${family}`,
			displayName: `${family} generation`,
			category: "gen",
			status: "shipped",
			listPrefix: `${family}:gen:`,
			pattern: `${family}:gen:<id>`,
			ttl: "sticky",
			nameSensitivity: "public",
			valueSensitivity: "no-read",
			refresh: { kind: "none" },
			description: "Scoped mutation epoch, never a business snapshot.",
		}),
	),

	// ─── Business cache (gen-keyed) ────────────────────────────────
	{
		family: "forum:tree:v2",
		displayName: "Forum tree (visibility-bucketed)",
		category: "cache",
		status: "shipped",
		listPrefix: "forum:tree:v2:",
		pattern: "forum:tree:v2:<bucket>:g<forumTreeGen>",
		ttl: 86400,
		tier: "LONG",
		loader: "forum",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-tree" },
		genKeys: ["forum:tree:gen"],
		description: "Cached forum hierarchy per visibility bucket. Bumped by forum CRUD.",
	},
	{
		family: "forum:summary:v2",
		displayName: "Forum summary list",
		category: "cache",
		status: "shipped",
		listPrefix: "forum:summary:v2:",
		pattern: "forum:summary:v2:<bucket>:g<forumSummaryGen>",
		ttl: 60,
		tier: "SHORT",
		loader: "forum",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-summary" },
		genKeys: ["forum:summary:gen"],
		description:
			"Per-bucket forum aggregates (counts, last-thread). Bumped by volatile forum writes.",
	},
	{
		family: "forum:meta:v2",
		displayName: "Forum meta (single-forum)",
		category: "cache",
		status: "historical",
		listPrefix: "forum:meta:v2:",
		pattern: "forum:meta:v2:<forumId>:<bucket>:g<forumSummaryGen>",
		ttl: 86400,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		genKeys: ["forum:summary:gen"],
		description: "Single-forum meta read on the read-by-id miss path. Shares forum:summary:gen.",
	},
	{
		family: "thread:list:v2",
		displayName: "Thread list (page1, two-gen)",
		category: "cache",
		status: "historical",
		listPrefix: "thread:list:v2:",
		pattern: "thread:list:v2:<forumId>:default:<limitBucket>:p1:gf<perForumGen>:ga<allGen>",
		ttl: 60,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		genKeys: ["thread:list:gen:all"],
		description:
			"Page1 thread-list cache, gated by both per-forum and global gen. Default refresh is per-forum bump; the global all-gen sweep lives on the gen:thread:list:all family for cross-forum invalidation.",
	},
	// ─── Per-user mini cache (live v1) ─────────────────────────────
	{
		family: "user:mini:v1",
		displayName: "User mini profile (v1, live)",
		category: "cache",
		status: "shipped",
		listPrefix: "user:mini:",
		pattern: "user:mini:<userId>",
		ttl: 86400,
		tier: "LONG",
		loader: "peripheral",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-user-mini", requires: ["userId"] },
		description:
			"Live v1 user mini cache (lib/user-cache.ts). NOT the planned v2 family. Listed under prefix 'user:mini:' which also includes the planned v2 entries — UI filters them out.",
	},
	// ─── IP lookup cache (Phase G.6) ───────────────────────────────
	{
		family: "ip-lookup",
		displayName: "IP lookup result (echo.nocoo.cloud)",
		category: "cache",
		status: "shipped",
		listPrefix: "ip-lookup:",
		pattern: "ip-lookup:<ip>",
		ttl: 86400,
		tier: "LONG",
		loader: "ip",
		// Suffix is the queried IP — masked in admin UI like other ip-keyed
		// families (login-ip / reg-ip).
		nameSensitivity: "mask",
		// Value contains geo / ASN / raw upstream payload — not strictly
		// secret but PII-adjacent. Flag as mask-value so the KV monitor
		// scrubs shape rather than dumping raw to a non-handler page;
		// the dedicated admin ip-lookup handler is the only intended
		// reader and returns the cached payload directly.
		valueSensitivity: "mask-value",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description:
			"Read-through cache of admin ip-lookup queries (handlers/admin/ip-lookup.ts). Suffix is the queried IP. Populated only via the admin handler — public callers never touch this prefix.",
	},
	// ─── Digest cache (visibility-bucketed, gen-keyed) ───────────────
	{
		family: "digest:stats",
		displayName: "Digest stats (per visibility bucket)",
		category: "cache",
		status: "shipped",
		listPrefix: "cache:v3:digest:stats:",
		pattern: "cache:v3:digest:stats:<hash>",
		ttl: 1800,
		tier: "MEDIUM",
		loader: "catalog",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-digest" },
		genKeys: ["digest:gen"],
		description:
			"Aggregate digest thread counts (total, level1-3) per visibility bucket. Gen-keyed for instant invalidation on digest changes.",
	},
	{
		family: "digest:filters",
		displayName: "Digest filters (per visibility bucket)",
		category: "cache",
		status: "shipped",
		listPrefix: "cache:v3:digest:filters:",
		pattern: "cache:v3:digest:filters:<hash>",
		ttl: 1800,
		tier: "MEDIUM",
		loader: "catalog",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-digest" },
		genKeys: ["digest:gen"],
		description:
			"Available filter options (years, forums with digest threads) per visibility bucket. Gen-keyed for instant invalidation.",
	},
	// ─── Recommended threads cache (per forum) ─────────────────────
	{
		family: "recommended:threads",
		displayName: "Recommended threads (per forum)",
		category: "cache",
		status: "shipped",
		listPrefix: "cache:v3:recommended:threads:",
		pattern: "cache:v3:recommended:threads:<hash>",
		ttl: 86400,
		tier: "LONG",
		loader: "catalog",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description:
			"Cached recommended threads list for each forum. Invalidated on recommend/unrecommend.",
	},
	// ─── Thread types cache (per forum) ────────────────────────────
	{
		family: "thread-types",
		displayName: "Thread types (per forum)",
		category: "cache",
		status: "shipped",
		listPrefix: "thread-types:",
		pattern: "thread-types:<forumId>",
		ttl: 86400,
		tier: "LONG",
		loader: "catalog",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description:
			"Cached thread types (主题分类) list for each forum. Invalidated on admin changes.",
	},
	// ─── Settings + public stats (literal keys) ────────────────────
	{
		family: "settings:all",
		displayName: "Settings (all, single key)",
		category: "cache",
		status: "shipped",
		listPrefix: "settings:all",
		keyKind: "exact",
		pattern: "settings:all",
		ttl: 86400,
		tier: "LONG",
		loader: "peripheral",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description: "Single literal key holding admin settings JSON (lib/settings.ts).",
	},
	{
		family: "public-stats",
		displayName: "Public stats snapshot",
		category: "stats",
		status: "shipped",
		listPrefix: "public-stats",
		keyKind: "exact",
		pattern: "public-stats",
		ttl: 60,
		tier: "SHORT",
		loader: "peripheral",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description:
			"Public stats endpoint cache (handlers/stats.ts). Refresh by deleting; next read re-warms.",
	},
	{
		family: "stats:online_count",
		displayName: "Online count",
		category: "stats",
		status: "shipped",
		listPrefix: "stats:online_count",
		keyKind: "exact",
		pattern: "stats:online_count",
		ttl: 300,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"Aggregated count of `online:*` markers, recomputed every 60s by lib/online-stats.ts.",
	},
	{
		family: "stats:online_peak",
		displayName: "Online peak (sticky)",
		category: "sticky-stats",
		status: "shipped",
		listPrefix: "stats:online_peak",
		keyKind: "exact",
		pattern: "stats:online_peak",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"All-time online peak. Sticky (no TTL) — only ever rewritten when new peak observed.",
	},
	{
		family: "stats:today_posts",
		displayName: "Today's posts counter",
		category: "stats",
		status: "historical",
		listPrefix: "stats:today_posts",
		keyKind: "exact",
		pattern: "stats:today_posts",
		ttl: 86_400,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"Legacy read-modify-write counter. Today now comes from committed indexed D1 rows.",
	},
	{
		family: "stats:today_date",
		displayName: "Today's date marker",
		category: "stats",
		status: "shipped",
		listPrefix: "stats:today_date",
		keyKind: "exact",
		pattern: "stats:today_date",
		ttl: 86_400,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"YYYY-MM-DD in Asia/Shanghai. Used by cron to detect day rollover for stats:today_posts.",
	},
	// ─── Online presence + activity throttle ───────────────────────
	{
		family: "online:user",
		displayName: "Online presence markers",
		category: "throttle",
		status: "shipped",
		listPrefix: "online:",
		pattern: "online:<userId>",
		ttl: 900,
		nameSensitivity: "mask",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description:
			"Per-user presence marker, refreshed on each authenticated request (middleware/online.ts). Suffix is a userId — masked.",
	},
	{
		family: "activity_throttle",
		displayName: "Activity throttle",
		category: "throttle",
		status: "shipped",
		listPrefix: "activity_throttle:",
		pattern: "activity_throttle:<userId>",
		ttl: 120,
		nameSensitivity: "mask",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description:
			"Throttles per-user activity bumps (middleware/activity.ts). Suffix is userId — masked.",
	},
	// ─── Auth refresh tokens + email verify ────────────────────────
	{
		family: "refresh",
		displayName: "Refresh tokens",
		category: "session",
		status: "shipped",
		listPrefix: "refresh:",
		pattern: "refresh:<refreshTokenString>",
		ttl: "variable",
		nameSensitivity: "hide",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description:
			"Per-session refresh tokens (handlers/auth.ts). Key NAME contains the token itself — hidden entirely; only count is shown.",
	},
	{
		family: "email_verify",
		displayName: "Email verify codes",
		category: "session",
		status: "shipped",
		listPrefix: "email_verify:",
		pattern: "email_verify:<userId>",
		ttl: "variable",
		nameSensitivity: "mask",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description:
			"Email verification code records (lib/email-verify.ts). userId masked. NOTE: prefix overlaps with email_verify_lock — UI filters by exact prefix.",
	},
	{
		family: "email_verify_lock",
		displayName: "Email verify send-lock",
		category: "session",
		status: "shipped",
		listPrefix: "email_verify_lock:",
		pattern: "email_verify_lock:<userId>",
		ttl: "variable",
		nameSensitivity: "mask",
		valueSensitivity: "no-read",
		refresh: { kind: "none" },
		description: "Send-lock to prevent duplicate verification email sends (lib/email-verify.ts).",
	},
	// ─── Rate-limit families ───────────────────────────────────────
	{
		family: "login-ip",
		displayName: "Login rate-limit (per IP)",
		category: "rate-limit",
		status: "shipped",
		listPrefix: "login-ip:",
		pattern: "login-ip:<ip>",
		ttl: 3600,
		nameSensitivity: "mask",
		valueSensitivity: "mask-value",
		refresh: { kind: "none" },
		description: "Failed login attempt counter per IP (handlers/auth.ts). IP masked (1.2.*.*).",
	},
	{
		family: "login-lockout-ip",
		displayName: "Login lockout (per IP)",
		category: "rate-limit",
		status: "shipped",
		listPrefix: "login-lockout-ip:",
		pattern: "login-lockout-ip:<ip>",
		ttl: 86400,
		nameSensitivity: "mask",
		valueSensitivity: "mask-value",
		refresh: { kind: "none" },
		description: "24h IP lockout after repeated login failures (handlers/auth.ts).",
	},
	{
		family: "reg-ip",
		displayName: "Register rate-limit (per IP)",
		category: "rate-limit",
		status: "shipped",
		listPrefix: "reg-ip:",
		pattern: "reg-ip:<ip>",
		ttl: 60,
		nameSensitivity: "mask",
		valueSensitivity: "mask-value",
		refresh: { kind: "none" },
		description: "Per-IP registration attempt counter (handlers/auth.ts).",
	},
	{
		family: "chk-usr-ip",
		displayName: "Check-username rate-limit (per IP)",
		category: "rate-limit",
		status: "shipped",
		listPrefix: "chk-usr-ip:",
		pattern: "chk-usr-ip:<ip>",
		ttl: 60,
		nameSensitivity: "mask",
		valueSensitivity: "mask-value",
		refresh: { kind: "none" },
		description: "Per-IP username-availability rate-limit (handlers/auth.ts).",
	},
	// ─── Generation tokens (sticky, no TTL) ────────────────────────
	{
		family: "gen:forum:tree",
		displayName: "Gen — forum:tree",
		category: "gen",
		status: "shipped",
		listPrefix: "forum:tree:gen",
		keyKind: "exact",
		pattern: "forum:tree:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-tree" },
		description:
			"Generation token for the schema-3 forum tree. Bumped by structural forum writes; the established family name is retained.",
	},
	{
		family: "gen:forum:summary",
		displayName: "Gen — forum:summary",
		category: "gen",
		status: "shipped",
		listPrefix: "forum:summary:gen",
		keyKind: "exact",
		pattern: "forum:summary:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-summary" },
		description:
			"Generation token for the schema-3 forum summary. Ordinary create/reply/view events rely on SHORT expiration.",
	},
	{
		family: "gen:thread:list:all",
		displayName: "Gen — thread:list (global)",
		category: "gen",
		status: "shipped",
		listPrefix: "thread:list:gen:all",
		keyKind: "exact",
		pattern: "thread:list:gen:all",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-thread-list-all" },
		description:
			"Global thread-list generation for global-announcement changes and explicit group invalidation. Known forum changes use scoped generations.",
	},
	{
		family: "gen:thread:list:per-forum",
		displayName: "Gen — thread:list (per-forum)",
		category: "gen",
		status: "shipped",
		listPrefix: "thread:list:gen:",
		pattern: "thread:list:gen:<forumId>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-thread-list-forum", requires: ["forumId"] },
		description:
			"Per-forum thread-list gens. The global `thread:list:gen:all` is split into its own family above so resolveFamilyForKey routes the literal name to the global bumper.",
	},
	{
		family: "gen:digest",
		displayName: "Gen — digest",
		category: "gen",
		status: "shipped",
		listPrefix: "digest:gen",
		keyKind: "exact",
		pattern: "digest:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-digest" },
		description: "Generation token for digest:list membership, bumped by digest-affecting writes.",
	},
	{
		family: "gen:thread:meta",
		displayName: "Gen — thread:meta",
		category: "gen",
		status: "shipped",
		listPrefix: "thread:meta:gen:",
		pattern: "thread:meta:gen:<threadId>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-thread-meta", requires: ["threadId"] },
		description: "Per-thread generation for thread:entity and thread:stats snapshots.",
	},
	{
		family: "gen:post:list",
		displayName: "Gen — post:list",
		category: "gen",
		status: "shipped",
		listPrefix: "post:list:gen:",
		pattern: "post:list:gen:<threadId>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-post-list", requires: ["threadId"] },
		description:
			"Per-thread generation for post:page membership, post:entity and post:attachments.",
	},
	// ─── Planned v2 / dead-builder-reserved ────────────────────────
	{
		family: "user:mini:v2",
		displayName: "User mini (v2, planned)",
		category: "cache",
		status: "planned",
		listPrefix: "user:mini:v2:",
		pattern: "user:mini:v2:<userId>",
		ttl: 86400,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description: "Planned v2 user-mini key (Phase 6). Builder exists; no live populator.",
	},
	{
		family: "user:public:v2",
		displayName: "用户公开资料",
		category: "cache",
		status: "shipped",
		listPrefix: "user:public:v2:",
		pattern: "user:public:v2:<userId>:<viewerBucket>",
		ttl: 1800,
		tier: "MEDIUM",
		loader: "user",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"Schema-3 public-user projection, separated into public and staff audiences with the established key name retained.",
	},
	{
		family: "settings:all:v2",
		displayName: "Settings (v2, dead-builder-reserved)",
		category: "cache",
		status: "dead-builder-reserved",
		listPrefix: "settings:all:v2",
		keyKind: "exact",
		pattern: "settings:all:v2",
		ttl: 600,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"Reserved for the v2 settings schema migration. Builder exists in keys.ts but no live caller — live key remains 'settings:all'.",
	},
	{
		family: "stats:public:v2",
		displayName: "Public stats (v2, dead-builder-reserved)",
		category: "stats",
		status: "dead-builder-reserved",
		listPrefix: "stats:public:v2",
		keyKind: "exact",
		pattern: "stats:public:v2",
		ttl: 60,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"Reserved for the v2 public-stats schema migration. Live key remains 'public-stats'.",
	},
];

/**
 * Find a registry entry by exact family identifier. Returns null when
 * the family is unknown so admin handlers can return a 404.
 */
export function findFamily(family: string): KvFamilySpec | null {
	for (const spec of KV_REGISTRY) {
		if (spec.family === family) return spec;
	}
	return null;
}

/**
 * Return the registry entry that best owns a raw KV key. Used by the
 * admin "list" endpoint to attach a family to each returned key, so
 * the UI can render the right sensitivity badge.
 *
 * Resolution rule:
 *   1. An `exact` family wins iff `key === listPrefix` (singletons).
 *   2. Otherwise the longest matching `listPrefix` (with ties broken by
 *      declaration order) for `prefix`-kind families. `exact` families
 *      whose `listPrefix !== key` are skipped here so that, e.g.,
 *      `settings:all:v2:foo` is NOT swallowed by the singleton
 *      `settings:all`.
 *
 * This handles overlaps like `user:mini:` / `user:mini:v2:` correctly,
 * and the global `thread:list:gen:all` (exact) sitting next to the
 * per-forum prefix `thread:list:gen:`.
 */
export function resolveFamilyForKey(key: string): KvFamilySpec | null {
	for (const spec of KV_REGISTRY) {
		if (spec.keyKind === "exact" && spec.listPrefix === key) {
			return spec;
		}
	}
	let best: KvFamilySpec | null = null;
	let bestLen = -1;
	for (const spec of KV_REGISTRY) {
		if (spec.keyKind === "exact") continue;
		if (key.startsWith(spec.listPrefix) && spec.listPrefix.length > bestLen) {
			best = spec;
			bestLen = spec.listPrefix.length;
		}
	}
	return best;
}

/**
 * Allowlist of every literal / template KV-key prefix the Worker writes
 * today. The architecture-guard test in
 * `tests/unit/lib/cache/kv-registry.test.ts` checks that this allowlist
 * matches the set of prefixes detected via grep on `apps/worker/src`.
 *
 * When you add a new `env.KV.put(...)` callsite, register the family
 * here AND in `KV_REGISTRY`. If the callsite is genuinely outside the
 * monitor scope (e.g. a one-off test fixture), document it in this
 * file and add the prefix to ALLOWLIST_OUT_OF_SCOPE below instead.
 */
export const KV_PUT_PREFIX_ALLOWLIST: readonly string[] = [
	"forum:tree:v2:",
	"forum:summary:v2:",
	"forum:meta:v2:",
	"thread:list:v2:",
	"user:mini:",
	"ip-lookup:",
	"digest:stats:",
	"digest:filters:",
	"recommended:threads:",
	"thread-types:",
	"settings:all",
	"public-stats",
	"stats:online_count",
	"stats:online_peak",
	"stats:today_posts",
	"stats:today_date",
	"online:",
	"activity_throttle:",
	"refresh:",
	"email_verify:",
	"email_verify_lock:",
	"login-ip:",
	"login-lockout-ip:",
	"reg-ip:",
	"chk-usr-ip:",
	"forum:tree:gen",
	"forum:summary:gen",
	"thread:list:gen:",
	"thread:list:gen:all",
	"digest:gen",
	"thread:meta:gen:",
	"post:list:gen:",
	"admin:entity:gen:",
];

/**
 * Prefixes deliberately NOT in the registry. Listed only so the
 * architecture-guard test can give a clear "you wrote this elsewhere
 * — is that intentional?" signal instead of failing silently.
 */
export const KV_PUT_PREFIX_OUT_OF_SCOPE: readonly string[] = [
	// (none today)
];

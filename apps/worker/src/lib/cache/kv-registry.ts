// KV registry — single source of truth for every KV key family the
// Worker writes today (or has reserved for the v2 migration). Drives
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

export interface KvFamilySpec {
	/** Stable family identifier — used in API params and metrics rows. */
	family: string;
	/** Human-readable label for the admin UI. */
	displayName: string;
	category: KvCategory;
	status: KvStatus;
	/** Prefix passed to `KV.list({prefix})` to enumerate keys in this family. */
	listPrefix: string;
	/** Human-readable expected key pattern — for UI tooltip only. */
	pattern: string;
	/**
	 * TTL in seconds. `"sticky"` means no TTL set (gen tokens, online_peak).
	 * `"variable"` means callers compute a TTL per write (e.g. email_verify
	 * `remaining`).
	 */
	ttl: number | "sticky" | "variable";
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
	// ─── Business cache (gen-keyed) ────────────────────────────────
	{
		family: "forum:tree:v2",
		displayName: "Forum tree (visibility-bucketed)",
		category: "cache",
		status: "shipped",
		listPrefix: "forum:tree:v2:",
		pattern: "forum:tree:v2:<bucket>:g<forumTreeGen>",
		ttl: 3600,
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
		status: "shipped",
		listPrefix: "forum:meta:v2:",
		pattern: "forum:meta:v2:<forumId>:<bucket>:g<forumSummaryGen>",
		ttl: 60,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-summary" },
		genKeys: ["forum:summary:gen"],
		description: "Single-forum meta read on the read-by-id miss path. Shares forum:summary:gen.",
	},
	{
		family: "thread:list:v2",
		displayName: "Thread list (page1, two-gen)",
		category: "cache",
		status: "shipped",
		listPrefix: "thread:list:v2:",
		pattern: "thread:list:v2:<forumId>:default:<limitBucket>:p1:gf<perForumGen>:ga<allGen>",
		ttl: 60,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-thread-list-all" },
		genKeys: ["thread:list:gen:all"],
		description:
			"Page1 thread-list cache, gated by both per-forum and global gen. Use bump-thread-list-forum for targeted invalidation.",
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
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-user-mini", requires: ["userId"] },
		description:
			"Live v1 user mini cache (lib/user-cache.ts). NOT the planned v2 family. Listed under prefix 'user:mini:' which also includes the planned v2 entries — UI filters them out.",
	},
	// ─── Settings + public stats (literal keys) ────────────────────
	{
		family: "settings:all",
		displayName: "Settings (all, single key)",
		category: "cache",
		status: "shipped",
		listPrefix: "settings:all",
		pattern: "settings:all",
		ttl: 600,
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
		pattern: "public-stats",
		ttl: 60,
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
		pattern: "stats:online_count",
		ttl: 300,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description:
			"Aggregated count of `online:*` markers, recomputed every 60s by lib/online-stats.ts.",
	},
	{
		family: "stats:online_peak",
		displayName: "Online peak (sticky)",
		category: "sticky-stats",
		status: "shipped",
		listPrefix: "stats:online_peak",
		pattern: "stats:online_peak",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "delete-literal", requires: ["key"] },
		description:
			"All-time online peak. Sticky (no TTL) — only ever rewritten when new peak observed.",
	},
	// ─── Online presence + activity throttle ───────────────────────
	{
		family: "online:user",
		displayName: "Online presence markers",
		category: "throttle",
		status: "shipped",
		listPrefix: "online:",
		pattern: "online:<userId>",
		ttl: 300,
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
		pattern: "forum:tree:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-tree" },
		description:
			"Generation token for forum:tree:v2 cache. Sticky — bumped (rewritten) by structural forum writes.",
	},
	{
		family: "gen:forum:summary",
		displayName: "Gen — forum:summary",
		category: "gen",
		status: "shipped",
		listPrefix: "forum:summary:gen",
		pattern: "forum:summary:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-forum-summary" },
		description:
			"Generation token for forum:summary:v2 + forum:meta:v2. Bumped by volatile writes.",
	},
	{
		family: "gen:thread:list:per-forum",
		displayName: "Gen — thread:list (per-forum)",
		category: "gen",
		status: "shipped",
		listPrefix: "thread:list:gen:",
		pattern: "thread:list:gen:<forumId> | thread:list:gen:all",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-thread-list-forum", requires: ["forumId"] },
		description:
			"Per-forum thread-list gen plus the global `thread:list:gen:all` (also matched by this prefix). UI distinguishes by suffix.",
	},
	{
		family: "gen:digest",
		displayName: "Gen — digest",
		category: "gen",
		status: "shipped",
		listPrefix: "digest:gen",
		pattern: "digest:gen",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-digest" },
		description:
			"Generation token for the planned digest:* caches. Already bumped by digest-affecting writes today.",
	},
	{
		family: "gen:thread:meta",
		displayName: "Gen — thread:meta (planned)",
		category: "gen",
		status: "planned",
		listPrefix: "thread:meta:gen:",
		pattern: "thread:meta:gen:<threadId>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-thread-meta", requires: ["threadId"] },
		description: "Per-thread gen reserved for the planned thread:meta:v2 cache.",
	},
	{
		family: "gen:post:list",
		displayName: "Gen — post:list (planned)",
		category: "gen",
		status: "planned",
		listPrefix: "post:list:gen:",
		pattern: "post:list:gen:<threadId>",
		ttl: "sticky",
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "bump-post-list", requires: ["threadId"] },
		description: "Per-thread gen reserved for the planned post:list:v2 cache.",
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
		displayName: "User public (v2, planned)",
		category: "cache",
		status: "planned",
		listPrefix: "user:public:v2:",
		pattern: "user:public:v2:<userId>:<viewerBucket>",
		ttl: 3600,
		nameSensitivity: "public",
		valueSensitivity: "public",
		refresh: { kind: "none" },
		description:
			"Planned per-viewer-bucket public-user cache. Builder + delete helper exist; no live populator.",
	},
	{
		family: "settings:all:v2",
		displayName: "Settings (v2, dead-builder-reserved)",
		category: "cache",
		status: "dead-builder-reserved",
		listPrefix: "settings:all:v2",
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
 * Resolution rule: longest matching `listPrefix`, with ties broken by
 * declaration order. This handles the `user:mini:` / `user:mini:v2:`
 * overlap correctly — v2 is more specific and wins for v2 keys, while
 * the v1 entry covers the bare prefix.
 */
export function resolveFamilyForKey(key: string): KvFamilySpec | null {
	let best: KvFamilySpec | null = null;
	let bestLen = -1;
	for (const spec of KV_REGISTRY) {
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
	"settings:all",
	"public-stats",
	"stats:online_count",
	"stats:online_peak",
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
	"digest:gen",
	"thread:meta:gen:",
	"post:list:gen:",
];

/**
 * Prefixes deliberately NOT in the registry. Listed only so the
 * architecture-guard test can give a clear "you wrote this elsewhere
 * — is that intentional?" signal instead of failing silently.
 */
export const KV_PUT_PREFIX_OUT_OF_SCOPE: readonly string[] = [
	// (none today)
];

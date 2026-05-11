// Admin KV monitor — read + safe-mutation handlers backing the
// `/admin/statistics/kv` page. All endpoints are gated by Key B at
// the router level (`apiKey` middleware) and additionally by
// `withEntityAuth` for the `auth: "admin"` flag.
//
// Design contract (see thread #ellie-后端细节:bdcb7183 v3 plan):
//
// 1. Family declared in `kv-registry.ts` is the single source of truth.
//    The handler never accepts arbitrary KV operations — every mutation
//    is dispatched through a typed `KvRefreshAction`.
//
// 2. Sensitivity masking is enforced server-side, not in the front end:
//    - `nameSensitivity: "hide"` → never return sample keys; `getKey`
//      refuses with `KV_KEY_NAME_HIDDEN`.
//    - `nameSensitivity: "mask"` → sample keys / `listFamily` results
//      have their suffix masked via `maskKeyName`.
//    - `valueSensitivity: "no-read"` → `getKey` refuses with
//      `KV_KEY_VALUE_FORBIDDEN` even on otherwise public-name keys.
//
// 3. Audit log on every mutation (`writeAdminLog` actions
//    `kv.bump_gen`, `kv.delete_key`). Audit details only carry the
//    family + masked key + category — never the raw value.
//
// 4. Cloudflare KV API quirks the handler papers over:
//    - `getWithMetadata` does NOT return expiration → for detail view
//      we additionally `KV.list({prefix: key, limit: 1})` and look up
//      the matching entry to surface `expiration`. Returns `null`
//      ("unknown") when the row is not in that page.
//    - `KV.list` is eventually-consistent and may return empty pages
//      with `list_complete: false`. Pagination terminates ONLY on
//      `list_complete === true`.
//
// 5. The `metrics` endpoint reads `kv_cache_metrics_minute` (added in
//    migration 0035), populated by the in-isolate accumulator + flush
//    in `lib/cache/metrics.ts`. Only business cache families are
//    instrumented (forum tree/summary/meta, thread:list page1, user
//    mini, settings, public stats); short-lived auth/rate-limit
//    families intentionally produce no metrics rows.

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpForumTreeGen,
	bumpPostListGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
} from "../../lib/cache/invalidate";
import {
	KV_REGISTRY,
	type KvFamilySpec,
	findFamily,
	resolveFamilyForKey,
} from "../../lib/cache/kv-registry";
import { flushPendingNow, recordDelete } from "../../lib/cache/metrics";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
import { invalidateUserCache } from "../../lib/user-cache";
import { errorResponse } from "../../middleware/error";

const kvConfig: EntityConfig = {
	table: "forums",
	entityName: "KV_MONITOR",
	auth: "admin",
	columns: "id",
	mapper: (row) => row,
	notFoundCode: "KV_FAMILY_NOT_FOUND",
};

// ─── Sensitivity masking helpers ──────────────────────────────────

/**
 * Hash a string to a short hex digest used to mask user identifiers
 * inside key names. Not a security primitive — only there so two
 * keys for the same user collapse to the same masked label so the
 * UI can show "1 user" vs "many".
 *
 * Uses SubtleCrypto SHA-256 (available in Workers runtime). Returns
 * the first 6 hex chars.
 */
async function shortHash(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < 3; i++) {
		out += bytes[i].toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * Mask the variable portion of an IPv4-style key suffix. Keeps the
 * first two octets and replaces the rest. IPv6 fallback: keep the
 * first 4 hex blocks.
 */
function maskIpSuffix(suffix: string): string {
	if (suffix.includes(".")) {
		const parts = suffix.split(".");
		if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
	}
	if (suffix.includes(":")) {
		const parts = suffix.split(":");
		if (parts.length >= 4) return `${parts.slice(0, 4).join(":")}::*`;
	}
	return "***";
}

/**
 * Apply the family's masking rule to a raw key. Pure for `public`,
 * async for `mask` because user-id masking uses SubtleCrypto.
 *
 * The handler never returns `hide` keys to clients — they're filtered
 * out before this function is called.
 */
async function maskKeyName(key: string, family: KvFamilySpec): Promise<string> {
	if (family.nameSensitivity === "public") return key;
	if (family.nameSensitivity === "hide") return "[hidden]";
	const suffix = key.slice(family.listPrefix.length);
	if (suffix.length === 0) return key;
	switch (family.family) {
		case "login-ip":
		case "login-lockout-ip":
		case "reg-ip":
		case "chk-usr-ip":
			return `${family.listPrefix}${maskIpSuffix(suffix)}`;
		case "online:user":
		case "activity_throttle":
		case "email_verify":
		case "email_verify_lock": {
			const h = await shortHash(suffix);
			return `${family.listPrefix}u_${h}`;
		}
		default:
			return `${family.listPrefix}***`;
	}
}

// ─── KV.list pagination helpers ───────────────────────────────────

/**
 * Walk `KV.list({prefix})` until `list_complete === true`, collecting
 * keys. Caller passes a per-page hard cap to avoid unbounded scans;
 * default 5000. Returns `{keys, scannedPages, truncated}` — `truncated`
 * means the cap was hit before pagination completed, in which case the
 * count is a lower bound.
 *
 * NOTE: Cloudflare KV `list` is eventually-consistent and may return
 * empty `keys` with `list_complete: false`. We MUST NOT short-circuit
 * on empty pages.
 */
async function listAllByPrefix(
	env: Env,
	prefix: string,
	hardCap = 5000,
): Promise<{
	keys: { name: string; expiration?: number }[];
	truncated: boolean;
}> {
	const out: { name: string; expiration?: number }[] = [];
	let cursor: string | undefined;
	let pages = 0;
	const PAGE_LIMIT = 1000;
	const MAX_PAGES = Math.max(1, Math.ceil(hardCap / PAGE_LIMIT));
	while (pages < MAX_PAGES) {
		const result = await env.KV.list({
			prefix,
			cursor,
			limit: PAGE_LIMIT,
		});
		for (const entry of result.keys) {
			out.push({ name: entry.name, expiration: entry.expiration });
			if (out.length >= hardCap) {
				return { keys: out, truncated: !result.list_complete };
			}
		}
		if (result.list_complete) {
			return { keys: out, truncated: false };
		}
		cursor = result.cursor;
		pages++;
	}
	return { keys: out, truncated: true };
}

/**
 * Look up the `expiration` for an exact key by paginating
 * `KV.list({prefix: key})` until either the entry shows up or
 * `list_complete === true`. Bounded by `hardCap` total scanned entries
 * (default 1000) so a runaway prefix can't blow up the request. Returns
 * `null` when not found within the cap or on transient errors —
 * "unknown" is acceptable in the detail UI.
 */
async function probeExpirationFor(env: Env, key: string, hardCap = 1000): Promise<number | null> {
	try {
		let cursor: string | undefined;
		let scanned = 0;
		while (scanned < hardCap) {
			const page = await env.KV.list({ prefix: key, cursor, limit: 1000 });
			for (const entry of page.keys) {
				if (entry.name === key) return entry.expiration ?? null;
			}
			scanned += page.keys.length;
			if (page.list_complete) return null;
			cursor = page.cursor;
		}
		return null;
	} catch {
		return null;
	}
}

// ─── Presence classification ──────────────────────────────────────

type Presence =
	| "present"
	| "absent"
	| "planned"
	| "historical"
	| "dead-builder-reserved"
	| "sensitive-hidden";

/**
 * Map (status, count, sensitivity) to a single presence label that the
 * UI can render directly without re-deriving the rule. `stale` is left
 * for commit B once metrics arrive.
 */
function classifyPresence(spec: KvFamilySpec, count: number): Presence {
	if (spec.nameSensitivity === "hide" && spec.status === "shipped") {
		return count > 0 ? "sensitive-hidden" : "absent";
	}
	if (spec.status === "planned") return "planned";
	if (spec.status === "historical") return "historical";
	if (spec.status === "dead-builder-reserved") return "dead-builder-reserved";
	return count > 0 ? "present" : "absent";
}

// ─── Body / param parsing ─────────────────────────────────────────

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const text = await request.text();
		if (!text) return {};
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function readQuery(request: Request, key: string): string | null {
	const url = new URL(request.url);
	const v = url.searchParams.get(key);
	return v && v.length > 0 ? v : null;
}

// ─── GET /api/admin/kv/overview ───────────────────────────────────
//
// Returns one row per declared family with current presence/count and
// a small sample of (masked) key names. Counts are bounded by the
// per-family list cap so a runaway prefix can't blow up the response.

interface OverviewRow {
	family: string;
	displayName: string;
	category: string;
	status: string;
	pattern: string;
	ttl: number | "sticky" | "variable";
	nameSensitivity: string;
	valueSensitivity: string;
	count: number;
	truncated: boolean;
	presence: Presence;
	currentGens?: { name: string; value: string | null }[];
	sampleKeys: string[];
}

const OVERVIEW_HARD_CAP = 1000;
const OVERVIEW_SAMPLE_SIZE = 5;

/**
 * Look up the current value of a gen token WITHOUT seeding a new one.
 * `getGen` from epoch.ts has the side-effect of writing a new token
 * when missing — that would change the very state the monitor is
 * supposed to observe, so the overview reads raw KV instead.
 */
async function readGenRaw(env: Env, name: string): Promise<string | null> {
	try {
		return await env.KV.get(name);
	} catch {
		return null;
	}
}

export const overview = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const rows: OverviewRow[] = [];
		for (const spec of KV_REGISTRY) {
			const baseRow: OverviewRow = {
				family: spec.family,
				displayName: spec.displayName,
				category: spec.category,
				status: spec.status,
				pattern: spec.pattern,
				ttl: spec.ttl,
				nameSensitivity: spec.nameSensitivity,
				valueSensitivity: spec.valueSensitivity,
				count: 0,
				truncated: false,
				presence: "absent",
				sampleKeys: [],
			};

			let owned: { name: string; expiration?: number }[];
			let truncated = false;

			if (spec.keyKind === "exact") {
				// Singleton family: count is 0 or 1, owned by exact name match.
				const single = await env.KV.get(spec.listPrefix);
				owned = single === null ? [] : [{ name: spec.listPrefix }];
			} else {
				const listed = await listAllByPrefix(env, spec.listPrefix, OVERVIEW_HARD_CAP);
				truncated = listed.truncated;
				owned = listed.keys.filter((k) => resolveFamilyForKey(k.name)?.family === spec.family);
			}

			baseRow.count = owned.length;
			baseRow.truncated = truncated;
			baseRow.presence = classifyPresence(spec, owned.length);

			if (spec.nameSensitivity !== "hide" && owned.length > 0) {
				const sampleSlice = owned.slice(0, OVERVIEW_SAMPLE_SIZE);
				baseRow.sampleKeys = await Promise.all(sampleSlice.map((k) => maskKeyName(k.name, spec)));
			}

			if (spec.genKeys && spec.genKeys.length > 0) {
				baseRow.currentGens = await Promise.all(
					spec.genKeys.map(async (genName) => ({
						name: genName,
						value: await readGenRaw(env, genName),
					})),
				);
			}

			rows.push(baseRow);
		}

		return jsonResponse({ families: rows }, origin);
	},
);

// ─── GET /api/admin/kv/list ───────────────────────────────────────
//
// Paginated list of keys for one family. Always applies sensitivity
// masking to the key names; refuses entirely when `nameSensitivity ===
// "hide"`. Returns expirations from the KV.list response (already an
// absolute unix-second value when set).

const LIST_PAGE_LIMIT = 100;
const LIST_MAX_PAGES = 10;

/**
 * Paginate `KV.list` for a `prefix`-kind family until either `limit`
 * owned keys are collected or KV reports `list_complete`. Filters out
 * sibling families that share the same listPrefix (e.g. `user:mini:v2:*`
 * keys are skipped when listing the `user:mini:v1` family). Bounded
 * by `LIST_MAX_PAGES` so a pathological family of mostly-sibling keys
 * cannot starve the request loop.
 */
async function collectOwnedKeys(
	env: Env,
	spec: KvFamilySpec,
	limit: number,
	startCursor: string | undefined,
): Promise<{
	owned: { name: string; expiration?: number }[];
	cursor: string | undefined;
	listComplete: boolean;
}> {
	const owned: { name: string; expiration?: number }[] = [];
	let nextCursor: string | undefined = startCursor;
	let listComplete = false;
	for (let page = 0; page < LIST_MAX_PAGES; page++) {
		const result = await env.KV.list({
			prefix: spec.listPrefix,
			cursor: nextCursor,
			limit,
		});
		for (const k of result.keys) {
			if (resolveFamilyForKey(k.name)?.family === spec.family) {
				owned.push(k);
				if (owned.length >= limit) break;
			}
		}
		if (result.list_complete) {
			listComplete = true;
			nextCursor = undefined;
			break;
		}
		nextCursor = result.cursor;
		if (owned.length >= limit) break;
	}
	return { owned, cursor: nextCursor, listComplete };
}

async function listSingletonFamily(
	env: Env,
	spec: KvFamilySpec,
	origin: string | undefined,
): Promise<Response> {
	const single = await env.KV.get(spec.listPrefix);
	const keys =
		single === null
			? []
			: [
					{
						key: await maskKeyName(spec.listPrefix, spec),
						rawKey: spec.nameSensitivity === "public" ? spec.listPrefix : null,
						expiration: await probeExpirationFor(env, spec.listPrefix),
					},
				];
	return jsonResponse({ family: spec.family, keys, cursor: null, listComplete: true }, origin);
}

export const listFamily = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const familyParam = readQuery(request, "family");
		if (!familyParam) {
			return errorResponse("MISSING_FAMILY", 400, undefined, origin);
		}
		const spec = findFamily(familyParam);
		if (!spec) {
			return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);
		}
		if (spec.nameSensitivity === "hide") {
			return errorResponse("KV_KEY_NAME_HIDDEN", 403, { family: spec.family }, origin);
		}

		// Singleton family: at most one key, no pagination needed.
		if (spec.keyKind === "exact") {
			return listSingletonFamily(env, spec, origin);
		}

		const cursor = readQuery(request, "cursor") ?? undefined;
		const limitRaw = readQuery(request, "limit");
		const limit = Math.min(
			Math.max(Number.parseInt(limitRaw ?? "", 10) || LIST_PAGE_LIMIT, 1),
			LIST_PAGE_LIMIT,
		);

		const {
			owned,
			cursor: nextCursor,
			listComplete,
		} = await collectOwnedKeys(env, spec, limit, cursor);

		const masked = await Promise.all(
			owned.slice(0, limit).map(async (k) => ({
				key: await maskKeyName(k.name, spec),
				rawKey: spec.nameSensitivity === "public" ? k.name : null,
				expiration: k.expiration ?? null,
			})),
		);

		return jsonResponse(
			{
				family: spec.family,
				keys: masked,
				cursor: listComplete ? null : (nextCursor ?? null),
				listComplete,
			},
			origin,
		);
	},
);

// ─── GET /api/admin/kv/get ────────────────────────────────────────
//
// Single key detail. Refuses when `valueSensitivity === "no-read"` so
// auth tokens / verification codes can never leak through this path.
// For `valueSensitivity === "mask-value"` we return only size +
// metadata, never the raw value (protects rate-limit counters etc.).

export const getKey = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const key = readQuery(request, "key");
		if (!key) return errorResponse("MISSING_KEY", 400, undefined, origin);

		const spec = resolveFamilyForKey(key);
		if (!spec) {
			return errorResponse("KV_FAMILY_NOT_FOUND", 404, { key }, origin);
		}
		if (spec.nameSensitivity === "hide") {
			return errorResponse("KV_KEY_NAME_HIDDEN", 403, { family: spec.family }, origin);
		}
		if (spec.valueSensitivity === "no-read") {
			return errorResponse("KV_KEY_VALUE_FORBIDDEN", 403, { family: spec.family }, origin);
		}

		const { value, metadata } = await env.KV.getWithMetadata(key);
		if (value === null) {
			return errorResponse("KV_KEY_NOT_FOUND", 404, { key }, origin);
		}

		// expiration is not on getWithMetadata — paginate list({prefix:key})
		// for the matching entry. Best-effort; null means "unknown".
		const expiration = await probeExpirationFor(env, key);

		const valueByteSize = new TextEncoder().encode(value).byteLength;
		const maskedKey = await maskKeyName(key, spec);

		// `mask-value`: never return raw payload. Only size + metadata.
		if (spec.valueSensitivity === "mask-value") {
			return jsonResponse(
				{
					family: spec.family,
					key: maskedKey,
					rawKey: spec.nameSensitivity === "public" ? key : null,
					value: null,
					valueMasked: true,
					valueByteSize,
					metadata: metadata ?? null,
					expiration,
				},
				origin,
			);
		}

		// public: try to parse value as JSON for the UI; fall back to raw string.
		let parsedValue: unknown = value;
		try {
			parsedValue = JSON.parse(value);
		} catch {
			// value is a plain string (counter, token-id reference, …)
		}

		return jsonResponse(
			{
				family: spec.family,
				key: maskedKey,
				rawKey: spec.nameSensitivity === "public" ? key : null,
				value: parsedValue,
				valueMasked: false,
				valueByteSize,
				metadata: metadata ?? null,
				expiration,
			},
			origin,
		);
	},
);

// ─── POST /api/admin/kv/refresh ───────────────────────────────────
//
// Single dispatcher for every typed `KvRefreshAction`. Body shape:
//   { family: string, action: { kind: "...", forumId?, key?, ... } }
// Action kind MUST match the family's declared `refresh.kind` so the
// front end can't smuggle a different action onto a family.

// Table of refresh actions that take no extra args and just call a
// generation-bump helper. Keeping these out of the main switch caps
// the cognitive complexity of `refresh`.
const SIMPLE_BUMP_ACTIONS: Record<string, { gen: string; run: (env: Env) => Promise<string> }> = {
	"bump-forum-tree": { gen: "forum:tree:gen", run: bumpForumTreeGen },
	"bump-forum-summary": { gen: "forum:summary:gen", run: bumpForumSummaryGen },
	"bump-thread-list-all": { gen: "thread:list:gen:all", run: bumpThreadListGenAll },
	"bump-digest": { gen: "digest:gen", run: bumpDigestGen },
};

export const refresh = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await parseBody(request);
		if (!body) return errorResponse("INVALID_BODY", 400, undefined, origin);

		const familyParam = typeof body.family === "string" ? body.family : null;
		if (!familyParam) return errorResponse("MISSING_FAMILY", 400, undefined, origin);
		const spec = findFamily(familyParam);
		if (!spec) return errorResponse("KV_FAMILY_NOT_FOUND", 404, undefined, origin);

		const action = body.action as { kind?: string } | undefined;
		const kind = action?.kind;
		if (!kind || kind !== spec.refresh.kind) {
			return errorResponse(
				"KV_ACTION_MISMATCH",
				400,
				{ family: spec.family, expected: spec.refresh.kind, got: kind ?? null },
				origin,
			);
		}

		const actor = resolveActor(request);

		// Simple no-arg bump actions are dispatched via a shared table to
		// keep the switch below under the lint complexity budget.
		const simpleBump = SIMPLE_BUMP_ACTIONS[spec.refresh.kind];
		if (simpleBump) {
			const newGen = await simpleBump.run(env);
			await writeAdminLog(env, actor, {
				action: "kv.bump_gen",
				targetType: "kv_family",
				targetId: null,
				details: { family: spec.family, gen: simpleBump.gen, newGen },
			});
			// Surface the just-recorded `bump` op in this same request.
			if (ctx) flushPendingNow(env, ctx);
			return jsonResponse({ ok: true, family: spec.family, newGen }, origin);
		}

		switch (spec.refresh.kind) {
			case "bump-thread-list-forum":
				return refreshBumpThreadListForum(env, actor, spec, action, origin, ctx);
			case "bump-thread-meta":
			case "bump-post-list":
				return refreshBumpThreadScoped(env, actor, spec, action, origin, ctx);
			case "delete-literal":
				return refreshDeleteLiteral(env, actor, spec, action, origin, ctx);
			case "delete-user-mini":
				return refreshDeleteUserMini(env, actor, spec, action, origin, ctx);
			case "none":
				return errorResponse("KV_ACTION_NOT_ALLOWED", 400, { family: spec.family }, origin);
		}
		return errorResponse("KV_ACTION_NOT_ALLOWED", 400, { family: spec.family }, origin);
	},
);

async function refreshBumpThreadListForum(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	ctx: ExecutionContext | undefined,
): Promise<Response> {
	const forumId = Number((action as { forumId?: unknown }).forumId);
	if (!Number.isInteger(forumId) || forumId <= 0) {
		return errorResponse("MISSING_FORUM_ID", 400, undefined, origin);
	}
	const newGen = await bumpThreadListGen(env, forumId);
	await writeAdminLog(env, actor, {
		action: "kv.bump_gen",
		targetType: "kv_family",
		targetId: forumId,
		details: { family: spec.family, gen: `thread:list:gen:${forumId}`, newGen },
	});
	if (ctx) flushPendingNow(env, ctx);
	return jsonResponse({ ok: true, family: spec.family, forumId, newGen }, origin);
}

async function refreshBumpThreadScoped(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	ctx: ExecutionContext | undefined,
): Promise<Response> {
	const threadId = Number((action as { threadId?: unknown }).threadId);
	if (!Number.isInteger(threadId) || threadId <= 0) {
		return errorResponse("MISSING_THREAD_ID", 400, undefined, origin);
	}
	const isMeta = spec.refresh.kind === "bump-thread-meta";
	const newGen = await (isMeta ? bumpThreadMetaGen : bumpPostListGen)(env, threadId);
	await writeAdminLog(env, actor, {
		action: "kv.bump_gen",
		targetType: "kv_family",
		targetId: threadId,
		details: {
			family: spec.family,
			gen: `${isMeta ? "thread:meta" : "post:list"}:gen:${threadId}`,
			newGen,
		},
	});
	if (ctx) flushPendingNow(env, ctx);
	return jsonResponse({ ok: true, family: spec.family, threadId, newGen }, origin);
}

async function refreshDeleteLiteral(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	ctx: ExecutionContext | undefined,
): Promise<Response> {
	const key = (action as { key?: unknown }).key;
	if (typeof key !== "string" || key.length === 0) {
		return errorResponse("MISSING_KEY", 400, undefined, origin);
	}
	const targetSpec = resolveFamilyForKey(key);
	if (!targetSpec || targetSpec.family !== spec.family) {
		return errorResponse("KV_KEY_FAMILY_MISMATCH", 400, { family: spec.family, key }, origin);
	}
	if (targetSpec.refresh.kind !== "delete-literal") {
		return errorResponse("KV_ACTION_NOT_ALLOWED", 400, { family: spec.family }, origin);
	}
	await env.KV.delete(key);
	recordDelete(targetSpec.family);
	const masked = await maskKeyName(key, targetSpec);
	await writeAdminLog(env, actor, {
		action: "kv.delete_key",
		targetType: "kv_key",
		targetId: null,
		details: { family: spec.family, maskedKey: masked },
	});
	if (ctx) flushPendingNow(env, ctx);
	return jsonResponse({ ok: true, family: spec.family, deleted: 1 }, origin);
}

async function refreshDeleteUserMini(
	env: Env,
	actor: Awaited<ReturnType<typeof resolveActor>>,
	spec: ReturnType<typeof findFamily> & object,
	action: { kind?: string } | undefined,
	origin: string | undefined,
	ctx: ExecutionContext | undefined,
): Promise<Response> {
	const userId = Number((action as { userId?: unknown }).userId);
	if (!Number.isInteger(userId) || userId <= 0) {
		return errorResponse("MISSING_USER_ID", 400, undefined, origin);
	}
	// `spec.family === "user:mini:v1"` (live). Route to the live v1
	// invalidator (`lib/user-cache.ts`) which writes the literal
	// `user:mini:<id>` key — NOT the planned-v2 `user:mini:v2:<id>`
	// helper in `lib/cache/invalidate.ts:deleteUserMini` (that one is
	// for the future v2 family and would silently miss the live row).
	// `invalidateUserCache` already records `delete` against the
	// `user:mini:v1` family; we don't double-count here.
	await invalidateUserCache(env, userId);
	await writeAdminLog(env, actor, {
		action: "kv.delete_key",
		targetType: "kv_key",
		targetId: userId,
		details: { family: spec.family },
	});
	if (ctx) flushPendingNow(env, ctx);
	return jsonResponse({ ok: true, family: spec.family, userId, deleted: 1 }, origin);
}

// ─── GET /api/admin/kv/metrics ────────────────────────────────────
//
// Per-minute op-dimensioned series for one or all instrumented families.
// Reads from `kv_cache_metrics_minute` (migration 0035), populated by the
// in-isolate accumulator + ctx.waitUntil flush in `lib/cache/metrics.ts`.
//
// Query params:
//   - `family` (optional): restrict to one registry family. When omitted
//     the response carries all rows in the window, grouped by family.
//   - `minutes`: window size in minutes (default 60, max 1440 = 24h).
//
// Response shape:
//   { family: string | null, minutes: number,
//     series: [{ family, tsMinute, op, count }, ...] }
//
// `op` is one of `read | hit | miss | write | bump | delete | error`.
// The UI derives hit-rate as `hit / (hit + miss)` and total ops as the
// sum across all op rows for the same (family, tsMinute).

export const metrics = withEntityAuth(
	kvConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const family = readQuery(request, "family");
		const minutes = Math.min(
			Math.max(Number.parseInt(readQuery(request, "minutes") ?? "60", 10) || 60, 1),
			1440,
		);
		const cutoff = Math.floor(Date.now() / 60_000) - minutes;

		try {
			const stmt = family
				? env.DB.prepare(
						`SELECT family, ts_minute, op, count
						 FROM kv_cache_metrics_minute
						 WHERE ts_minute >= ? AND family = ?
						 ORDER BY ts_minute ASC, op ASC`,
					).bind(cutoff, family)
				: env.DB.prepare(
						`SELECT family, ts_minute, op, count
						 FROM kv_cache_metrics_minute
						 WHERE ts_minute >= ?
						 ORDER BY family ASC, ts_minute ASC, op ASC`,
					).bind(cutoff);
			const result = await stmt.all<{
				family: string;
				ts_minute: number;
				op: string;
				count: number;
			}>();
			const series = result.results.map((r) => ({
				family: r.family,
				tsMinute: r.ts_minute,
				op: r.op,
				count: r.count,
			}));
			return jsonResponse({ family: family ?? null, minutes, series }, origin);
		} catch (err) {
			// Table may be missing on a fresh deploy before migration 0035
			// has run. Surface that as an empty series rather than 500 so
			// the admin page degrades gracefully.
			console.warn("[admin/kv] metrics query failed", err);
			return jsonResponse(
				{
					family: family ?? null,
					minutes,
					series: [],
					note: "metrics table unavailable",
				},
				origin,
			);
		}
	},
);

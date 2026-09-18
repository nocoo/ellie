import type { User } from "@ellie/types";
import { withEntityAuth } from "../../lib/adminHelpers";
import {
	type AdminLogActor,
	resolveActor,
	sanitizeAdminLogDetails,
	writeAdminLog,
} from "../../lib/adminLog";
import {
	getAdminEntities,
	invalidateAdminEntityCache,
	readAdminEntity,
} from "../../lib/cache/admin-entity-read";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpPostAttachmentsGen,
	bumpThreadListGenAll,
	invalidateThreadListForForums,
	invalidateThreadReading,
	invalidateUserCaches,
} from "../../lib/cache/invalidate";
import type { EntityConfig } from "../../lib/crud";
import { createListHandler, createUpdateHandler } from "../../lib/crud";
import { confirmedBatch, confirmedRun } from "../../lib/d1-write";
import type { Env } from "../../lib/env";
import { toUser } from "../../lib/mappers";
import { parsePathSegment } from "../../lib/parseId";
import { buildContentRecalcStatements } from "../../lib/recalcMetadata";
import { jsonNoStoreResponse } from "../../lib/response";
import { deleteUserContent, readUserContentSnapshot } from "../../lib/userContentDelete";
import { buildUserCounterDecrementStatements } from "../../lib/userCounters";
import { buildTombstoneStatement } from "../../lib/userTombstone";
import { STICKY_GLOBAL } from "../../lib/visibility";
// Admin user handlers (#36-#42) — CRUD framework + custom actions
import { errorResponse } from "../../middleware/error";
import { invalidateRecommendedCache } from "../recommended";

// ─── Column list (never SELECT * — excludes password_hash, password_salt) ────

// Listing users reads maintained counters; expensive recounts are explicit maintenance.
const USER_COLUMNS =
	"id, username, email, avatar, avatar_path, has_avatar, status, role, reg_date, last_login," +
	" threads, posts," +
	" credits, coins, signature, group_title, group_stars, group_color, custom_title," +
	" digest_posts," +
	" ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city," +
	" graduate_school, bio, interest, qq, site, campus, last_activity, email_verified_at," +
	" email_normalized, email_changed_at, reg_ip, last_ip, purged_at, purged_by";

// ─── Entity config ───────────────────────────────────────────────────────────

const userConfig: EntityConfig = {
	table: "users",
	entityName: "USER",
	auth: "admin",
	columns: USER_COLUMNS,
	mapper: toUser,
	notFoundCode: "USER_NOT_FOUND",

	// #36 filters
	filters: [
		{ param: "username", column: "username", type: "like" },
		{ param: "email", column: "email", type: "like" },
		{ param: "status", column: "status", type: "exact", parse: "int" },
		{ param: "role", column: "role", type: "exact", parse: "int" },
		// D3: same-IP query — exact match, no LIKE wildcards (PII surface).
		{ param: "regIp", column: "reg_ip", type: "exact" },
		{ param: "lastIp", column: "last_ip", type: "exact" },
		// Batch E: 高级过滤器 — inclusive numeric ranges (Batch A `range`
		// type). Default param naming `${param}Min`/`${param}Max` matches
		// the admin AdminFilters key convention (Batch B). Date columns
		// are stored as unix seconds; the UI converts local-day inputs
		// to 00:00:00 / 23:59:59 unix seconds (Batch B helpers) so
		// inclusive bounds line up.
		//
		// `0` survives both sides (worker `Number.isFinite` guard) — a
		// `lastLoginMin=0` filter selects users with `last_login >= 0`
		// (i.e. everyone, including never-logged-in `last_login = 0`),
		// and `creditsMin=0` selects everyone with non-negative credits.
		{ param: "regDate", column: "reg_date", type: "range" },
		{ param: "lastLogin", column: "last_login", type: "range" },
		{ param: "threads", column: "threads", type: "range" },
		{ param: "posts", column: "posts", type: "range" },
		{ param: "credits", column: "credits", type: "range" },
		{ param: "coins", column: "coins", type: "range" },
		// Write-gate visibility filters — surface the same rules the worker
		// enforces at post/reply/DM time (see lib/postingPermission.ts +
		// requireVerifiedEmail). Both accept `true`/`1` / `false`/`0`; any
		// other value is a no-op (matches `positive` semantics).
		//
		// emailVerified: users.email_verified_at is a unix timestamp — 0 iff
		// unverified. `positive` fits exactly.
		{ param: "emailVerified", column: "email_verified_at", type: "positive" },
		// hasAvatar: matches postingPermission's rule of
		// `!!avatar_path || has_avatar === 1` so operators can filter on the
		// *effective* avatar state the write gate reads, not just one column.
		{
			param: "hasAvatar",
			column: "",
			type: "expr",
			trueExpr: "(avatar_path != '' OR has_avatar = 1)",
			falseExpr: "(avatar_path = '' AND (has_avatar IS NULL OR has_avatar = 0))",
		},
	],
	listSort: "id DESC",

	// #38 update fields
	//
	// Admin-side PATCH: gives operators full editing access to every editable
	// `users` column. Validation is intentionally **type-only** (string vs
	// number-integer) rather than format-bound — admins must be able to
	// repair legacy/inconsistent rows that the public-facing endpoints would
	// reject (long usernames, ASCII-only emails missing `@`, etc.). The
	// invariants we DO keep are:
	//   - `status` and `role` remain enums (visibility / cache buckets read
	//     these; a stray value would corrupt user:public viewer routing).
	//   - `username` non-empty + uniqueness pre-check (DB has UNIQUE; without
	//     this guard an operator typo becomes a 500).
	//   - `emailNormalized` non-empty uniqueness pre-check (matching the
	//     partial unique index `users_email_normalized_uniq` from migration
	//     0029 — `WHERE email_normalized != ''`).
	// Sensitive / lifecycle-only columns are NOT exposed:
	//   - `password_hash` / `password_salt` (never SELECTed; auth-only).
	//   - `purged_at` / `purged_by` (only the purge endpoint may write these
	//     to keep tombstones consistent with status=-99).
	updateFields: [
		{
			name: "username",
			column: "username",
			validate: (v) => {
				if (typeof v !== "string") return "username must be a string";
				if (v.trim().length === 0) return "username cannot be empty";
				return null;
			},
		},
		{
			name: "email",
			column: "email",
			validate: (v) => (typeof v === "string" ? null : "email must be a string"),
		},
		{
			name: "avatar",
			column: "avatar",
			validate: (v) => (typeof v === "string" ? null : "avatar must be a string"),
		},
		{
			name: "avatarPath",
			column: "avatar_path",
			validate: (v) => (typeof v === "string" ? null : "avatarPath must be a string"),
		},
		{
			name: "status",
			column: "status",
			validate: (v) => {
				if (typeof v !== "number") return "status must be a number";
				if (v !== 0 && v !== -1 && v !== -2) return "status must be 0, -1, or -2";
				return null;
			},
		},
		{
			name: "role",
			column: "role",
			validate: (v) => {
				if (typeof v !== "number") return "role must be a number";
				if (v < 0 || v > 3 || !Number.isInteger(v)) return "role must be 0, 1, 2, or 3";
				return null;
			},
		},
		// Counter-style integer fields — admin can rewrite any of them; per-id
		// recalc-counters endpoint exists for the source-of-truth path. Type
		// guard only.
		...(
			[
				["credits", "credits"],
				["coins", "coins"],
				["threads", "threads"],
				["posts", "posts"],
				["digestPosts", "digest_posts"],
				["groupStars", "group_stars"],
				["olTime", "ol_time"],
				["lastActivity", "last_activity"],
				["regDate", "reg_date"],
				["lastLogin", "last_login"],
				["emailVerifiedAt", "email_verified_at"],
				["emailChangedAt", "email_changed_at"],
				["gender", "gender"],
				["birthYear", "birth_year"],
				["birthMonth", "birth_month"],
				["birthDay", "birth_day"],
			] as const
		).map(([name, column]) => ({
			name,
			column,
			validate: (v: unknown) => {
				if (typeof v !== "number") return `${name} must be a number`;
				if (!Number.isInteger(v)) return `${name} must be an integer`;
				return null;
			},
		})),
		// Plain string fields — type guard only. Admin must be able to set
		// any value (including empty) without format constraint.
		// Read-only / lifecycle-only fields — explicitly REJECTED if present
		// in the request body (rather than silently ignored as the CRUD
		// framework would otherwise do for unknown columns). This makes the
		// security contract observable: a hand-crafted PATCH body containing
		// `purgedAt` / `purgedBy` / `passwordHash` / `passwordSalt` (in any
		// camel/snake case) gets a 400 validation error instead of a 200 with
		// the field silently dropped. `purged_at`/`purged_by` may only be set
		// by the dedicated /purge endpoint (tombstone consistency); password
		// material is never PATCHable from the admin surface.
		...(
			[
				["purgedAt", "purged_at"],
				["purgedBy", "purged_by"],
				["passwordHash", "password_hash"],
				["passwordSalt", "password_salt"],
				// snake_case aliases — handle clients that send the column
				// name directly. Same reject path.
				["purged_at", "purged_at_alias"],
				["purged_by", "purged_by_alias"],
				["password_hash", "password_hash_alias"],
				["password_salt", "password_salt_alias"],
			] as const
		).map(([name, _column]) => ({
			name,
			// `column` is irrelevant here because validate always returns an
			// error before any UPDATE SQL is generated. Use a sentinel that
			// would never be a real column to make accidental write impossible.
			column: "__forbidden__",
			validate: (_v: unknown) => `${name} is read-only and cannot be set via PATCH`,
		})),
		...(
			[
				["signature", "signature"],
				["groupTitle", "group_title"],
				["groupColor", "group_color"],
				["customTitle", "custom_title"],
				["resideProvince", "reside_province"],
				["resideCity", "reside_city"],
				["graduateSchool", "graduate_school"],
				["bio", "bio"],
				["interest", "interest"],
				["qq", "qq"],
				["site", "site"],
				["campus", "campus"],
				["regIp", "reg_ip"],
				["lastIp", "last_ip"],
				["emailNormalized", "email_normalized"],
			] as const
		).map(([name, column]) => ({
			name,
			column,
			validate: (v: unknown) => (typeof v === "string" ? null : `${name} must be a string`),
		})),
	],

	// #38 beforeUpdate: ALREADY_PURGED guard + username/emailNormalized uniqueness.
	// D4-a: PATCH /api/admin/users/:id is the canonical attack surface for
	// hand-crafted writes (e.g. resurrecting a tombstone), so the guard sits
	// inside beforeUpdate where it cannot be bypassed by a future updateFields
	// expansion. ban/nuke/purge each repeat the check via existing-row query.
	beforeUpdate: async (id, data, existing, env, origin) => {
		const existingStatus = (existing as { status?: number }).status;
		if (existingStatus === -99) {
			return errorResponse("ALREADY_PURGED", 409, undefined, origin);
		}

		// Username uniqueness check (DB has UNIQUE on `username`).
		if (data.username !== undefined) {
			const existingRow = await env.DB.prepare(
				"SELECT id FROM users WHERE username = ? AND id != ?",
			)
				.bind(data.username, id)
				.first();
			if (existingRow) {
				return errorResponse("USERNAME_TAKEN", 409, undefined, origin);
			}
		}

		// Phase C (C1 precise): admin email writes can intentionally bypass the
		// partial UNIQUE index on `email_normalized`. The flow is:
		//
		//   - Admin PATCH includes `email` but NOT `emailNormalized` → we
		//     auto-set `email_normalized = ''`. The partial index from 0029
		//     (`WHERE email_normalized != ''`) ignores empty strings, so the
		//     raw `email` column may now collide with another user without
		//     constraint failure. This is the operator escape hatch for legacy
		//     / merged accounts where the same address is intentionally shared.
		//
		//   - Admin PATCH explicitly provides `emailNormalized` (any value) →
		//     we do NOT touch it. A non-empty value still goes through the
		//     uniqueness pre-check below and surfaces a clean 409 if taken;
		//     an explicit empty string is honoured as-is.
		//
		// Login / forgot-password do NOT key on `email_normalized` (login is
		// by username; the only readers of `email_normalized` are the email
		// verify/correct flows, which gate on `email_verified_at = 0` and
		// uniqueness — both safe with empty strings). So clearing it for
		// admin-managed rows is a localized escape hatch, not a global change.
		if (typeof data.email === "string" && !Object.hasOwn(data, "email_normalized")) {
			data.email_normalized = "";
		}

		// emailNormalized uniqueness — partial unique index from migration
		// 0029 only constrains non-empty values:
		//   CREATE UNIQUE INDEX users_email_normalized_uniq
		//     ON users(email_normalized) WHERE email_normalized != ''
		// Pre-check non-empty values against other ids to surface a clean
		// 409 instead of letting D1 raise a 500 constraint failure.
		if (typeof data.email_normalized === "string" && data.email_normalized !== "") {
			const existingRow = await env.DB.prepare(
				"SELECT id FROM users WHERE email_normalized = ? AND id != ?",
			)
				.bind(data.email_normalized, id)
				.first();
			if (existingRow) {
				return errorResponse("EMAIL_NORMALIZED_TAKEN", 409, undefined, origin);
			}
		}

		return undefined;
	},

	// Public profiles and the private self profile share this user-scoped
	// invalidation. Include private email fields in addition to display/gates.
	afterUpdate: async (id, data, _existing, env, _origin) => {
		const cacheFields = [
			// Identity / display
			"username",
			"avatar",
			"avatar_path",
			"email",
			"email_verified_at",
			"email_normalized",
			"email_changed_at",
			"last_login",
			// Visibility / status gate
			"status",
			"role",
			// Aggregates surfaced by user:public
			"credits",
			"coins",
			"threads",
			"posts",
			"digest_posts",
			"ol_time",
			"last_activity",
			"reg_date",
			// Group / title
			"group_title",
			"group_stars",
			"group_color",
			"custom_title",
			// Profile fields exposed by toPublicUser
			"signature",
			"gender",
			"birth_year",
			"birth_month",
			"birth_day",
			"reside_province",
			"reside_city",
			"graduate_school",
			"bio",
			"interest",
			"qq",
			"site",
			"campus",
			// IP fields are exposed when includeIp=true (admin/self bucket)
			"reg_ip",
			"last_ip",
		];
		const needsInvalidation = cacheFields.some((field) => data[field] !== undefined);
		if (needsInvalidation) {
			await invalidateUserCaches(env, id);
		}
	},
};

// ─── D4-b: tombstone-aware ALREADY_PURGED helper for batch endpoints ────────
// Returns the subset of input ids that are tombstoned (status === -99). Empty
// array means "safe to proceed". Used by batchStatus / batchRole /
// batchRecalcCounters to refuse the whole batch instead of silently skipping
// — see D4 D0 v3 §2.

async function fetchTombstoneIds(env: Env, ids: number[]): Promise<number[]> {
	if (ids.length === 0) return [];
	const r = await env.DB.prepare(
		"SELECT id FROM users WHERE id IN (SELECT value FROM json_each(?)) AND status = -99",
	)
		.bind(JSON.stringify(ids))
		.all();
	if (!r.success) throw new Error("User tombstone query failed");
	return (r.results as { id: number }[]).map((row) => row.id);
}

// ─── Cache fan-out helper for admin user batch endpoints ────────────────────
// Drop all profile variants once per affected user in bounded user batches.
// KV failures are swallowed inside the composite helper (best-effort).
const USER_CACHE_FAN_OUT_CHUNK = 50;
async function invalidateUserCachesForIds(env: Env, ids: number[]): Promise<void> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return;
	await invalidateAdminEntityCache(env, "users");
	for (let i = 0; i < unique.length; i += USER_CACHE_FAN_OUT_CHUNK) {
		const chunk = unique.slice(i, i + USER_CACHE_FAN_OUT_CHUNK);
		await Promise.all(chunk.map((uid) => invalidateUserCaches(env, uid)));
	}
}

// ─── #36 GET /api/admin/users ────────────────────────────────────────────────

export const list = withEntityAuth(userConfig, createListHandler(userConfig));

// ─── #37 GET /api/admin/users/:id ────────────────────────────────────────────
// G.5: enrich the detail payload with the `online:<uid>` KV soft signal so the
// admin UI can show "当前在线 IP / 页面 / 心跳" alongside the persistent
// `last_ip` ("上次登录 IP"). Treated strictly as a soft signal:
//   - KV miss → fields absent (UI hides the section).
//   - Shape guard: ip/page must be string, ts must be number; otherwise treated
//     as miss. Defends against hand-poked / corrupt KV values.
//   - Freshness guard: `Date.now()/1000 - ts <= 900` (TTL window). KV TTL is
//     authoritative on Cloudflare's side, but a leftover/clock-skew row should
//     not be presented as "currently online".
// Falls through to a non-enriched response on any KV failure (offline) so the
// detail endpoint never breaks because of a soft-signal lookup.

const ONLINE_TTL_SEC = 900;

interface OnlineSnapshot {
	ip: string;
	page: string;
	ts: number;
}

async function readOnlineSnapshot(env: Env, userId: number): Promise<OnlineSnapshot | null> {
	let raw: unknown;
	try {
		raw = await env.KV.get(`online:${userId}`, "json");
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.ip !== "string" || typeof r.page !== "string" || typeof r.ts !== "number") {
		return null;
	}
	const nowSec = Math.floor(Date.now() / 1000);
	// G.5.1: reject both stale (ts beyond TTL window) and impossible-future
	// timestamps. The online tracker is a same-worker writer so any negative
	// age is hand-poked / corrupt KV — must not be presented as "currently
	// online".
	const age = nowSec - r.ts;
	if (age < 0 || age > ONLINE_TTL_SEC) return null;
	return { ip: r.ip, page: r.page, ts: r.ts };
}

export const getById = withEntityAuth(
	userConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 0);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		const row = await readAdminEntity<User | null>(env, ctx, {
			family: "admin:entity:detail",
			params: { entity: "users", id },
			scope: "admin",
		});
		if (!row) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}

		const online = await readOnlineSnapshot(env, id);
		return jsonNoStoreResponse(
			{
				...row,
				...(online ? { onlineIp: online.ip, onlinePage: online.page, onlineTs: online.ts } : {}),
			},
			origin,
		);
	},
);

// ─── #38 PATCH /api/admin/users/:id ──────────────────────────────────────────

export const update = withEntityAuth(userConfig, createUpdateHandler(userConfig));

// ─── #39 POST /api/admin/users/:id/ban ───────────────────────────────────────

export const ban = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		// Verify user exists. Pull status/role too so we can apply ALREADY_PURGED
		// guard without a second query (D4-a).
		const existing = await env.DB.prepare("SELECT id, status, role FROM users WHERE id = ?")
			.bind(id)
			.first<{ id: number; status: number; role: number }>();
		if (!existing) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}
		if (existing.status === -99) {
			return errorResponse("ALREADY_PURGED", 409, undefined, origin);
		}

		// Parse optional body
		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			body = {};
		}

		const deleteContent = body.deleteContent === true;

		if (!deleteContent) {
			const written = await confirmedRun(
				env.DB.prepare("UPDATE users SET status = -1 WHERE id = ?").bind(id),
			);
			await Promise.all([
				written.meta.changes > 0 && existing.status !== -1
					? invalidateUserCachesForIds(env, [id])
					: Promise.resolve(),
				writeAdminLog(env, resolveActor(request, env), {
					action: "user.ban",
					targetType: "user",
					targetId: id,
					details: { mode: "ban", deletedContent: false },
				}),
			]);
			return jsonNoStoreResponse({ banned: true, id, contentDeleted: false }, origin);
		}

		// Ban + delete all content
		const result = await deleteUserContent(env, id);

		// Audit and cache invalidation run after the deletion transaction commits.
		const banDeleteOps: Promise<unknown>[] = [
			writeAdminLog(env, resolveActor(request, env), {
				action: "user.ban",
				targetType: "user",
				targetId: id,
				details: {
					mode: "ban_delete_content",
					deletedContent: true,
					deletedThreads: result.threadsDeleted,
					deletedPosts: result.postsDeleted,
				},
			}),
			invalidateThreadListForForums(env, result.affectedForumIds),
			invalidateThreadReading(env, result.affectedThreadIds, { posts: true }),
			...result.affectedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
			bumpForumSummaryGen(env),
			invalidateUserCachesForIds(env, [id, ...result.collateralAuthorIds]),
		];
		if (result.affectedThreadIds.length > 0)
			banDeleteOps.push(invalidateAdminEntityCache(env, "threads"));
		if (result.affectedForumIds.length > 0)
			banDeleteOps.push(invalidateAdminEntityCache(env, "forums"));
		if (result.postsDeleted > 0)
			banDeleteOps.push(
				invalidateAdminEntityCache(env, "posts"),
				invalidateAdminEntityCache(env, "attachments"),
			);
		if (result.hadDigestThread) banDeleteOps.push(bumpDigestGen(env));
		if (result.hadGlobalThread) banDeleteOps.push(bumpThreadListGenAll(env));
		await Promise.all(banDeleteOps);

		return jsonNoStoreResponse(
			{
				banned: true,
				id,
				contentDeleted: true,
				threadsDeleted: result.threadsDeleted,
				postsDeleted: result.postsDeleted,
			},
			origin,
		);
	},
);

// ─── F3-a POST /api/admin/users/:id/unban ────────────────────────────────────
//
// Dedicated unban endpoint introduced alongside F3-a audit instrumentation so
// the action gets its own admin_logs row (`user.unban`) instead of hiding
// inside the generic `update` PATCH path. Mirrors ban/nuke/purge guards:
//   - INVALID_REQUEST  → bad path id
//   - USER_NOT_FOUND   → no row
//   - ALREADY_PURGED   → status === -99 tombstone, refuse
//   - INVALID_REQUEST  → user is not currently banned (status !== -1)
// On success: status -1 → 0. role / credits / PII left untouched.

export const unban = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		const existing = await env.DB.prepare("SELECT id, status, role FROM users WHERE id = ?")
			.bind(id)
			.first<{ id: number; status: number; role: number }>();
		if (!existing) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}
		if (existing.status === -99) {
			return errorResponse("ALREADY_PURGED", 409, undefined, origin);
		}
		if (existing.status !== -1) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "User is not currently banned" },
				origin,
			);
		}

		const written = await confirmedRun(
			env.DB.prepare("UPDATE users SET status = 0 WHERE id = ?").bind(id),
		);
		await Promise.all([
			written.meta.changes > 0 ? invalidateUserCachesForIds(env, [id]) : Promise.resolve(),
			writeAdminLog(env, resolveActor(request, env), {
				action: "user.unban",
				targetType: "user",
				targetId: id,
				details: { previousStatus: existing.status },
			}),
		]);

		return jsonNoStoreResponse({ unbanned: true, id, previousStatus: existing.status }, origin);
	},
);

// ─── #40 POST /api/admin/users/:id/nuke ──────────────────────────────────────

export const nuke = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		// Verify user exists + ALREADY_PURGED guard (D4-a)
		const existing = await env.DB.prepare("SELECT id, status, role FROM users WHERE id = ?")
			.bind(id)
			.first<{ id: number; status: number; role: number }>();
		if (!existing) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}
		if (existing.status === -99) {
			return errorResponse("ALREADY_PURGED", 409, undefined, origin);
		}

		// Nuke = ban + delete content + zero credits (always deletes content)
		const result = await deleteUserContent(env, id, { resetCredits: true });

		// Invalidate caches and write the audit after the atomic DB cleanup.
		const nukeOps: Promise<unknown>[] = [
			invalidateUserCachesForIds(env, [id, ...result.collateralAuthorIds]),
			invalidateThreadListForForums(env, result.affectedForumIds),
			invalidateThreadReading(env, result.affectedThreadIds, { posts: true }),
			...result.affectedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
			bumpForumSummaryGen(env),
			writeAdminLog(env, resolveActor(request, env), {
				action: "user.nuke",
				targetType: "user",
				targetId: id,
				details: {
					deletedThreads: result.threadsDeleted,
					deletedPosts: result.postsDeleted,
				},
			}),
		];
		if (result.affectedThreadIds.length > 0)
			nukeOps.push(invalidateAdminEntityCache(env, "threads"));
		if (result.affectedForumIds.length > 0) nukeOps.push(invalidateAdminEntityCache(env, "forums"));
		if (result.postsDeleted > 0)
			nukeOps.push(
				invalidateAdminEntityCache(env, "posts"),
				invalidateAdminEntityCache(env, "attachments"),
			);
		if (result.hadDigestThread) nukeOps.push(bumpDigestGen(env));
		if (result.hadGlobalThread) nukeOps.push(bumpThreadListGenAll(env));
		await Promise.all(nukeOps);

		return jsonNoStoreResponse(
			{
				nuked: true,
				id,
				threadsDeleted: result.threadsDeleted,
				postsDeleted: result.postsDeleted,
			},
			origin,
		);
	},
);

// ─── D4-b POST /api/admin/users/:id/purge ────────────────────────────────────
// "彻底清除" — delete user content + tombstone the user row + best-effort R2.
//
// D4-b SCOPE (replaces D4-a 501 skeleton; merges original D4-c R2 step):
//   - DB cleanup + counter repair + audit + tombstone in one env.DB.batch().
//   - Counter and latest-content metadata repair are inside that same batch.
//   - After DB commit + cache invalidation: best-effort R2 deletes (avatar +
//     attachments). R2 failures DO NOT fail the request — reported in response.
//
// AUDIT TABLES INTENTIONALLY NOT TOUCHED:
//   reports, admin_logs, ip_bans, censor_words, announcements all preserved.
//   Only user-authored CONTENT is removed: threads, posts, post_comments,
//   attachments, messages.
//
// ACTOR IDENTITY:
//   purged_by is hard-coded to 0 (admin-panel system actor). The Next admin
//   proxy injects X-Admin-Actor-Email / X-Admin-Actor-Name headers which are
//   read here ONLY for the response.audit field — never for SELF_PURGE
//   semantics, since admin sessions don't carry a numeric users.id. SELF_PURGE
//   is therefore not implementable in D4-b and is intentionally absent. (Once
//   admin-email → users.id mapping exists we re-introduce the guard.)
//
// Request body:
//   { confirm: "ok" }    — fixed token, not the target username. The dialog
//                          asks the operator to type "ok" so we don't have
//                          to round-trip the (potentially long / non-ASCII)
//                          username; the irreversibility warning lives in
//                          the dialog copy.
//
// Guards (in order):
//   INVALID_BODY        bad JSON or missing/non-string confirm
//   USER_NOT_FOUND      target id missing
//   CONFIRM_MISMATCH    confirm !== "ok"
//   CANNOT_PURGE_STAFF  target.role > 0
//   Already-purged targets return success without repeating the mutation.
//
// Failure semantics:
//   - DB batch failure → check the tombstone before reporting an unconfirmed result.
//     A transport failure can lose the response after the transaction commits.
//   - R2 failures → 200 with response.r2.failed[] populated. DB is the source
//     of truth; orphan R2 objects can be cleaned by a future GC pass.

interface PurgeOwnedThread {
	id: number;
	forum_id: number;
	digest: number;
	sticky: number;
}
interface PurgeOwnedThreadPost {
	id: number;
	author_id: number;
}
interface PurgeStandalonePost {
	id: number;
	thread_id: number;
	forum_id: number;
}
interface PurgeAttachment {
	file_path: string;
	post_id: number;
}

interface PurgeTarget {
	id: number;
	username: string;
	status: number;
	role: number;
	avatar_path: string;
}

interface PurgePreflight {
	ownedThreads: PurgeOwnedThread[];
	ownedThreadIds: number[];
	ownedThreadPosts: PurgeOwnedThreadPost[];
	standalonePosts: PurgeStandalonePost[];
	allDeletedPostIds: number[];
	survivorThreadIds: number[];
	affectedForumIds: number[];
	collateralAuthorDelta: Map<number, number>;
	attachmentKeys: string[];
	attachmentPostIds: number[];
	hadDigestThread: boolean;
	hadGlobalThread: boolean;
	commentCount: number;
	attachmentCount: number;
	messageCount: number;
}

async function parsePurgeBody(
	request: Request,
): Promise<{ ok: true } | { ok: false; res: Response }> {
	const origin = request.headers.get("Origin") ?? undefined;
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return {
			ok: false,
			res: errorResponse(
				"INVALID_BODY",
				400,
				{ message: 'purge requires { confirm: "ok" } body' },
				origin,
			),
		};
	}
	const confirm = body?.confirm;
	if (typeof confirm !== "string") {
		return {
			ok: false,
			res: errorResponse("INVALID_BODY", 400, { message: "confirm must be a string" }, origin),
		};
	}
	if (confirm !== "ok") {
		return {
			ok: false,
			res: errorResponse("CONFIRM_MISMATCH", 400, { message: 'confirm must equal "ok"' }, origin),
		};
	}
	return { ok: true };
}

function checkPurgeGuards(target: PurgeTarget | null, origin: string | undefined): Response | null {
	if (!target) return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	if (target.role > 0) return errorResponse("CANNOT_PURGE_STAFF", 403, undefined, origin);
	return null;
}

// Builds a 3-way OR clause covering rows authored by the target plus rows
// that hang off content being deleted. Used for `attachments` and
// `post_comments` so the target's own contributions in survivor threads
// (where they neither own the thread nor wrote a deleted post) still get
// removed. Always returns a clause — `author_id = ?` alone is a valid
// shape even when no posts/threads are being deleted.
// Bind ID snapshots as JSON arrays: 50 threads + their 50 first posts
// already exceed D1's 100-parameter limit when expanded into placeholders.
function buildAuthorContentWhere(
	authorId: number,
	allDeletedPostIds: number[],
	ownedThreadIds: number[],
): { where: string; binds: unknown[] } {
	const parts: string[] = ["author_id = ?"];
	const binds: unknown[] = [authorId];
	if (allDeletedPostIds.length > 0) {
		parts.push("post_id IN (SELECT value FROM json_each(?))");
		binds.push(JSON.stringify(allDeletedPostIds));
	}
	if (ownedThreadIds.length > 0) {
		parts.push("thread_id IN (SELECT value FROM json_each(?))");
		binds.push(JSON.stringify(ownedThreadIds));
	}
	return { where: parts.join(" OR "), binds };
}

async function purgePreflight(env: Env, id: number): Promise<PurgePreflight> {
	const { threads: ownedThreads, posts } = await readUserContentSnapshot(env, id);
	const ownedThreadIds = ownedThreads.map((t) => t.id);
	const ownedIds = new Set(ownedThreadIds);
	const ownedThreadPosts = posts.filter((p) => ownedIds.has(p.thread_id));
	const standalonePosts = posts.filter((p) => !ownedIds.has(p.thread_id));
	const allDeletedPostIds = posts.map((p) => p.id);

	const survivorThreadIds = Array.from(new Set(standalonePosts.map((p) => p.thread_id))).filter(
		(tid) => !ownedThreadIds.includes(tid),
	);
	const affectedForumIds = Array.from(
		new Set([...ownedThreads.map((t) => t.forum_id), ...standalonePosts.map((p) => p.forum_id)]),
	);

	const collateralAuthorDelta = new Map<number, number>();
	for (const p of ownedThreadPosts) {
		if (p.author_id === id) continue;
		collateralAuthorDelta.set(p.author_id, (collateralAuthorDelta.get(p.author_id) ?? 0) + 1);
	}

	const attWhere = buildAuthorContentWhere(id, allDeletedPostIds, ownedThreadIds);

	// 4 independent counting/listing queries — fan out via Promise.all.
	// Saves 3 D1 round-trips on the user-purge admin operation.
	const [r2KeysRes, attCountRow, commentRow, messageCountRow] = await Promise.all([
		env.DB.prepare(`SELECT DISTINCT file_path, post_id FROM attachments WHERE ${attWhere.where}`)
			.bind(...attWhere.binds)
			.all<PurgeAttachment>(),
		env.DB.prepare(`SELECT COUNT(DISTINCT id) as cnt FROM attachments WHERE ${attWhere.where}`)
			.bind(...attWhere.binds)
			.first<{ cnt: number }>(),
		env.DB.prepare(`SELECT COUNT(DISTINCT id) as cnt FROM post_comments WHERE ${attWhere.where}`)
			.bind(...attWhere.binds)
			.first<{ cnt: number }>(),
		env.DB.prepare("SELECT COUNT(*) as cnt FROM messages WHERE sender_id = ? OR receiver_id = ?")
			.bind(id, id)
			.first<{ cnt: number }>(),
	]);

	if (!r2KeysRes.success) throw new Error("Purge attachment snapshot failed");
	const attachmentKeys = [...new Set(r2KeysRes.results.map((a) => a.file_path).filter(Boolean))];
	const attachmentPostIds = [...new Set(r2KeysRes.results.map((a) => a.post_id))].filter(
		(postId) => Number.isSafeInteger(postId) && postId > 0,
	);
	const attachmentCount = attCountRow?.cnt ?? 0;
	const commentCount = commentRow?.cnt ?? 0;
	const messageCount = messageCountRow?.cnt ?? 0;

	return {
		ownedThreads,
		ownedThreadIds,
		ownedThreadPosts,
		standalonePosts,
		allDeletedPostIds,
		survivorThreadIds,
		affectedForumIds,
		collateralAuthorDelta,
		attachmentKeys,
		attachmentPostIds,
		hadDigestThread:
			ownedThreads.some((thread) => thread.digest > 0) ||
			posts.some((post) => (post.thread_digest ?? 0) > 0),
		hadGlobalThread:
			ownedThreads.some((thread) => thread.sticky === STICKY_GLOBAL) ||
			posts.some((post) => post.thread_sticky === STICKY_GLOBAL),
		commentCount,
		attachmentCount,
		messageCount,
	};
}

function buildPurgeBatch(
	env: Env,
	id: number,
	pre: PurgePreflight,
	nowSec: number,
	actor: AdminLogActor,
): D1PreparedStatement[] {
	const stmts: D1PreparedStatement[] = [];
	const { allDeletedPostIds, ownedThreadIds } = pre;

	// post_comments + attachments share the same 3-way OR clause: rows
	// authored by the target, OR rows hanging off posts/threads being
	// deleted. Single DELETE per table avoids overlapping double-delete.
	const authorWhere = buildAuthorContentWhere(id, allDeletedPostIds, ownedThreadIds);
	stmts.push(
		env.DB.prepare(`DELETE FROM post_comments WHERE ${authorWhere.where}`).bind(
			...authorWhere.binds,
		),
	);
	stmts.push(
		env.DB.prepare(`DELETE FROM attachments WHERE ${authorWhere.where}`).bind(...authorWhere.binds),
	);

	if (allDeletedPostIds.length > 0) {
		stmts.push(
			env.DB.prepare("DELETE FROM posts WHERE id IN (SELECT value FROM json_each(?))").bind(
				JSON.stringify(allDeletedPostIds),
			),
		);
	}
	if (ownedThreadIds.length > 0) {
		const threadIdsJson = JSON.stringify(ownedThreadIds);
		stmts.push(
			env.DB.prepare(
				"DELETE FROM forum_recommended_threads WHERE thread_id IN (SELECT value FROM json_each(?))",
			).bind(threadIdsJson),
		);
		// threads_fts trigger fires automatically on threads delete
		stmts.push(
			env.DB.prepare("DELETE FROM threads WHERE id IN (SELECT value FROM json_each(?))").bind(
				threadIdsJson,
			),
		);
	}
	stmts.push(
		env.DB.prepare("DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?").bind(id, id),
	);

	stmts.push(
		...buildContentRecalcStatements(env, pre.survivorThreadIds, pre.affectedForumIds),
		...buildUserCounterDecrementStatements(env, pre.collateralAuthorDelta, "posts", id),
		env.DB.prepare(
			`INSERT INTO admin_logs (admin_id, admin_name, action, target_type, target_id, details, ip, created_at)
			 SELECT ?, ?, 'user.purge', 'user', ?, ?, ?, ?
			 WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND status != -99)`,
		).bind(
			actor.adminId,
			actor.adminName,
			id,
			sanitizeAdminLogDetails({
				deletedThreads: pre.ownedThreads.length,
				deletedPosts: pre.allDeletedPostIds.length,
				deletedComments: pre.commentCount,
				deletedAttachments: pre.attachmentCount,
				deletedMessages: pre.messageCount,
				actorEmail: actor.adminEmail,
			}),
			actor.ip,
			nowSec,
			id,
		),
	);

	stmts.push(buildTombstoneStatement(env, id, 0, nowSec));
	return stmts;
}

async function purgeR2Cleanup(
	env: Env,
	keys: string[],
): Promise<{ deletedCount: number; failed: { key: string; error: string }[] }> {
	const failed: { key: string; error: string }[] = [];
	let deletedCount = 0;
	for (let offset = 0; offset < keys.length; offset += 1000) {
		const batch = keys.slice(offset, offset + 1000);
		try {
			await env.R2.delete(batch);
			deletedCount += batch.length;
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			for (const key of batch) failed.push({ key, error });
		}
	}
	return { deletedCount, failed };
}

export const purge = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		const actorEmail = request.headers.get("X-Admin-Actor-Email") ?? "";
		const actorName = request.headers.get("X-Admin-Actor-Name") ?? "";

		const parsed = await parsePurgeBody(request);
		if (!parsed.ok) return parsed.res;

		const existing = await env.DB.prepare(
			"SELECT id, username, status, role, avatar_path FROM users WHERE id = ?",
		)
			.bind(id)
			.first<PurgeTarget>();
		const guard = checkPurgeGuards(existing, origin);
		if (guard) return guard;
		// existing is non-null past the guard
		const target = existing as PurgeTarget;
		if (target.status === -99) {
			return jsonNoStoreResponse({ purged: true, id, alreadyPurged: true }, origin);
		}

		const pre = await purgePreflight(env, id);
		const nowSec = Math.floor(Date.now() / 1000);
		const stmts = buildPurgeBatch(env, id, pre, nowSec, resolveActor(request, env));

		try {
			await confirmedBatch(env, stmts);
		} catch (err) {
			console.error("[purge] DB batch failed", { userId: id, err });
			let committed = false;
			try {
				const row = await env.DB.prepare("SELECT status FROM users WHERE id = ?")
					.bind(id)
					.first<{ status: number }>();
				committed = row?.status === -99;
			} catch (readError) {
				console.error("[purge] Cannot confirm commit", { userId: id, err: readError });
			}
			if (!committed) return errorResponse("PURGE_DB_FAILED", 500, undefined, origin);
		}

		// Include survivors whose last-post metadata changed, and posts whose
		// uploads were removed even though the post itself survived.
		const purgeOps: Promise<unknown>[] = [
			invalidateThreadListForForums(env, pre.affectedForumIds),
			invalidateThreadReading(env, [...pre.ownedThreadIds, ...pre.survivorThreadIds], {
				posts: true,
			}),
			...pre.affectedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
			bumpForumSummaryGen(env),
			invalidateUserCachesForIds(env, [id, ...pre.collateralAuthorDelta.keys()]),
		];
		if (pre.ownedThreadIds.length > 0 || pre.survivorThreadIds.length > 0)
			purgeOps.push(invalidateAdminEntityCache(env, "threads"));
		if (pre.affectedForumIds.length > 0) purgeOps.push(invalidateAdminEntityCache(env, "forums"));
		if (pre.allDeletedPostIds.length > 0) purgeOps.push(invalidateAdminEntityCache(env, "posts"));
		if (pre.attachmentCount > 0) purgeOps.push(invalidateAdminEntityCache(env, "attachments"));
		if (pre.hadDigestThread) purgeOps.push(bumpDigestGen(env));
		if (pre.hadGlobalThread) purgeOps.push(bumpThreadListGenAll(env));
		const invalidations = await Promise.allSettled(purgeOps);
		for (const result of invalidations) {
			if (result.status === "rejected") {
				console.warn("[purge] Cache invalidation failed", { userId: id, err: result.reason });
			}
		}
		for (let start = 0; start < pre.attachmentPostIds.length; start += 50) {
			await Promise.all(
				pre.attachmentPostIds
					.slice(start, start + 50)
					.map((postId) => bumpPostAttachmentsGen(env, postId)),
			);
		}

		const r2Keys = Array.from(
			new Set([...pre.attachmentKeys, ...(target.avatar_path ? [target.avatar_path] : [])]),
		);
		const r2 = await purgeR2Cleanup(env, r2Keys);

		return jsonNoStoreResponse(
			{
				purged: true,
				id,
				deleted: {
					threads: pre.ownedThreads.length,
					posts: pre.allDeletedPostIds.length,
					comments: pre.commentCount,
					attachments: pre.attachmentCount,
					messages: pre.messageCount,
				},
				audit: { actorEmail, actorName },
				r2: { deletedCount: r2.deletedCount, failed: r2.failed },
			},
			origin,
		);
	},
);

// ─── #43 GET /api/admin/users/batch?ids=1,2,3 ───────────────────────────────

const MAX_BATCH_FETCH = 100;

export const batchFetch = withEntityAuth(
	userConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);
		const raw = url.searchParams.get("ids");
		if (!raw) {
			return errorResponse("INVALID_REQUEST", 400, { message: "ids query param required" }, origin);
		}

		const ids = raw
			.split(",")
			.map((s) => Number.parseInt(s.trim(), 10))
			.filter((n) => Number.isSafeInteger(n) && n > 0);

		if (ids.length === 0) {
			return jsonNoStoreResponse([], origin);
		}
		if (ids.length > MAX_BATCH_FETCH) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_BATCH_FETCH} IDs per request` },
				origin,
			);
		}

		const rows = await getAdminEntities<User>(env, ctx, "users", ids);
		return jsonNoStoreResponse([...rows.values()], origin);
	},
);

// ─── #41 POST /api/admin/users/batch-status ──────────────────────────────────

const MAX_BATCH_SIZE = 100;
const VALID_STATUSES = new Set([0, -1, -2]);

export const batchStatus = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}

		if (!Array.isArray(body.ids) || body.ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must be a non-empty array" },
				origin,
			);
		}
		if (body.ids.length > MAX_BATCH_SIZE) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_BATCH_SIZE} items per batch` },
				origin,
			);
		}
		if (typeof body.status !== "number" || !VALID_STATUSES.has(body.status)) {
			return errorResponse("INVALID_BODY", 400, { message: "status must be 0, -1, or -2" }, origin);
		}

		// Parse and validate IDs
		const ids = body.ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id));

		if (ids.length === 0) {
			return jsonNoStoreResponse({ updated: true, count: 0 }, origin);
		}

		// D4-b: refuse if any target is already tombstoned. Whole batch fails
		// — never silently skip; admin must explicitly drop the tombstoned ids.
		const tombstoned = await fetchTombstoneIds(env, ids);
		if (tombstoned.length > 0) {
			return errorResponse("ALREADY_PURGED", 409, { tombstoneIds: tombstoned }, origin);
		}

		const written = await confirmedRun(
			env.DB.prepare(
				"UPDATE users SET status = ? WHERE id IN (SELECT value FROM json_each(?))",
			).bind(body.status, JSON.stringify(ids)),
		);

		// docs/20 §5: confirmed status changes invalidate all scoped user snapshots.
		if (written.meta.changes > 0) await invalidateUserCachesForIds(env, ids);

		return jsonNoStoreResponse({ updated: true, count: written.meta.changes }, origin);
	},
);

// ─── #42 POST /api/admin/users/batch-role ────────────────────────────────────

const VALID_ROLES = new Set([0, 1, 2, 3]);

export const batchRole = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}

		if (!Array.isArray(body.ids) || body.ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must be a non-empty array" },
				origin,
			);
		}
		if (body.ids.length > MAX_BATCH_SIZE) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_BATCH_SIZE} items per batch` },
				origin,
			);
		}
		if (typeof body.role !== "number" || !VALID_ROLES.has(body.role)) {
			return errorResponse("INVALID_BODY", 400, { message: "role must be 0, 1, 2, or 3" }, origin);
		}

		// Parse and validate IDs
		const ids = body.ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id));

		if (ids.length === 0) {
			return jsonNoStoreResponse({ updated: true, count: 0 }, origin);
		}

		// D4-b: ALREADY_PURGED guard — same shape as batchStatus.
		const tombstoned = await fetchTombstoneIds(env, ids);
		if (tombstoned.length > 0) {
			return errorResponse("ALREADY_PURGED", 409, { tombstoneIds: tombstoned }, origin);
		}

		const written = await confirmedRun(
			env.DB.prepare("UPDATE users SET role = ? WHERE id IN (SELECT value FROM json_each(?))").bind(
				body.role,
				JSON.stringify(ids),
			),
		);

		// docs/20 §5: role change feeds the visibility bucket and the
		// public profile group_title — invalidate per id (legacy + v2).
		if (written.meta.changes > 0) await invalidateUserCachesForIds(env, ids);

		return jsonNoStoreResponse({ updated: true, count: written.meta.changes }, origin);
	},
);

// ─── POST /api/admin/users/:id/recalc-counters ──────────────────────────────
// Recalculate a user's threads/posts/digest_posts counts from actual data.

export const recalcCounters = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1); // /api/admin/users/:id/recalc-counters
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		// Verify user exists + ALREADY_PURGED guard (D4-b)
		const user = await env.DB.prepare("SELECT id, status FROM users WHERE id = ?")
			.bind(id)
			.first<{ id: number; status: number }>();
		if (!user) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}
		if (user.status === -99) {
			return errorResponse("ALREADY_PURGED", 409, undefined, origin);
		}

		// Count threads authored by user
		// Three independent counts — fan out via Promise.all.
		const [threadsRow, postsRow, digestRow] = await Promise.all([
			env.DB.prepare("SELECT COUNT(*) as cnt FROM threads WHERE author_id = ?")
				.bind(id)
				.first<{ cnt: number }>(),
			env.DB.prepare("SELECT COUNT(*) as cnt FROM posts WHERE author_id = ?")
				.bind(id)
				.first<{ cnt: number }>(),
			env.DB.prepare("SELECT COUNT(*) as cnt FROM threads WHERE author_id = ? AND digest > 0")
				.bind(id)
				.first<{ cnt: number }>(),
		]);

		const threads = threadsRow?.cnt ?? 0;
		const posts = postsRow?.cnt ?? 0;
		const digestPosts = digestRow?.cnt ?? 0;

		// Update user counters
		const written = await confirmedRun(
			env.DB.prepare("UPDATE users SET threads = ?, posts = ?, digest_posts = ? WHERE id = ?").bind(
				threads,
				posts,
				digestPosts,
				id,
			),
		);

		if (written.meta.changes > 0) await invalidateUserCachesForIds(env, [id]);

		return jsonNoStoreResponse({ id, threads, posts, digestPosts }, origin);
	},
);

// ─── POST /api/admin/users/batch-recalc-counters ────────────────────────────
// Batch recalculate counters for multiple users (or all users if ids omitted).

const MAX_BATCH_RECALC = 1000;

export const batchRecalcCounters = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown> = {};
		try {
			const text = await request.text();
			if (text) body = JSON.parse(text) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}

		let userIds: number[];

		if (Array.isArray(body.ids) && body.ids.length > 0) {
			// Specific user IDs provided
			userIds = body.ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
			if (userIds.length > MAX_BATCH_RECALC) {
				return errorResponse(
					"BATCH_LIMIT_EXCEEDED",
					400,
					{ message: `Maximum ${MAX_BATCH_RECALC} users per batch` },
					origin,
				);
			}
			// D4-b: explicit-id path may target tombstoned users — refuse the
			// whole batch so the admin notices. Implicit "all active" path
			// below already filters status >= 0 which excludes -99.
			const tombstoned = await fetchTombstoneIds(env, userIds);
			if (tombstoned.length > 0) {
				return errorResponse("ALREADY_PURGED", 409, { tombstoneIds: tombstoned }, origin);
			}
		} else {
			// No IDs provided - get all active user IDs (status >= 0)
			const result = await env.DB.prepare(
				`SELECT id FROM users WHERE status >= 0 LIMIT ${MAX_BATCH_RECALC}`,
			).all();
			if (!result.success) throw new Error("User counter snapshot failed");
			userIds = result.results.map((r) => (r as { id: number }).id);
		}

		if (userIds.length === 0) {
			return jsonNoStoreResponse({ updated: 0 }, origin);
		}

		// One statement keeps the whole update atomic and avoids a 1000-ID
		// parameter list or a 1000-statement transaction.
		const [written] = await confirmedBatch(env, [
			env.DB.prepare(`UPDATE users SET
				threads = (SELECT COUNT(*) FROM threads WHERE author_id = users.id),
				posts = (SELECT COUNT(*) FROM posts WHERE author_id = users.id),
				digest_posts = (SELECT COUNT(*) FROM threads WHERE author_id = users.id AND digest > 0)
				WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(userIds)),
		]);

		// docs/20 §5: per-id user cache invalidation. Chunked
		// to avoid fan-out storms when called with the implicit "all active
		// users" path.
		if (written.meta.changes > 0) await invalidateUserCachesForIds(env, userIds);

		return jsonNoStoreResponse({ updated: written.meta.changes }, origin);
	},
);

// ─── GET /api/admin/users/staff ─────────────────────────────────────────────
// List all staff users (role > 0: Moderator, SuperMod, Admin).
// Returns simplified list sorted by role (Admin first) then username.

export const listStaff = withEntityAuth(
	userConfig,
	async (request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		const rows = await readAdminEntity<User[]>(env, ctx, {
			family: "admin:users:staff",
			params: {},
			scope: "admin",
		});
		return jsonNoStoreResponse(rows, origin);
	},
);

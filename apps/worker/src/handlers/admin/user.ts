import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import {
	buildDeletePostChildStatements,
	buildDeleteThreadChildStatements,
} from "../../lib/contentDelete";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler, createListHandler, createUpdateHandler } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { invalidateForumVolatile } from "../../lib/forum-cache";
import { toUser } from "../../lib/mappers";
import { parsePathSegment } from "../../lib/parseId";
import { recalcForumMetadata, recalcThreadMetadata } from "../../lib/recalcMetadata";
import { jsonResponse } from "../../lib/response";
import { invalidateUserCache } from "../../lib/user-cache";
import { batchDecrementUserPosts } from "../../lib/userCounters";
import { buildTombstoneStatement } from "../../lib/userTombstone";
import { POST_VISIBLE, THREAD_VISIBLE, postVisible, threadVisible } from "../../lib/visibility";
// Admin user handlers (#36-#42) — CRUD framework + custom actions
import { errorResponse } from "../../middleware/error";

// ─── Column list (never SELECT * — excludes password_hash, password_salt) ────

// D4-a: purged_at/purged_by added for tombstone tracking.
const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity, email_verified_at, email_normalized, email_changed_at, reg_ip, last_ip, purged_at, purged_by";

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
	],
	listSort: "id DESC",

	// #38 update fields
	updateFields: [
		{
			name: "username",
			column: "username",
			validate: (v) => {
				if (typeof v !== "string") return "username must be a string";
				if (v.trim().length === 0) return "username cannot be empty";
				if (v.length > 50) return "username must be at most 50 characters";
				return null;
			},
		},
		{
			name: "email",
			column: "email",
			validate: (v) => {
				if (typeof v !== "string") return "email must be a string";
				if (!v.includes("@")) return "email must contain @";
				if (v.length > 255) return "email must be at most 255 characters";
				return null;
			},
		},
		{
			name: "avatar",
			column: "avatar",
			validate: (v) => {
				if (typeof v !== "string") return "avatar must be a string";
				return null;
			},
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
		{
			name: "credits",
			column: "credits",
			validate: (v) => {
				if (typeof v !== "number") return "credits must be a number";
				if (!Number.isInteger(v)) return "credits must be an integer";
				return null;
			},
		},
	],

	// #38 beforeUpdate: ALREADY_PURGED guard + username uniqueness.
	// D4-a: PATCH /api/admin/users/:id is the canonical attack surface for
	// hand-crafted writes (e.g. resurrecting a tombstone), so the guard sits
	// inside beforeUpdate where it cannot be bypassed by a future updateFields
	// expansion. ban/nuke/purge each repeat the check via existing-row query.
	beforeUpdate: async (id, data, existing, env, origin) => {
		const existingStatus = (existing as { status?: number }).status;
		if (existingStatus === -99) {
			return errorResponse("ALREADY_PURGED", 409, undefined, origin);
		}

		// Username uniqueness check
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

		return undefined;
	},

	// #38 afterUpdate: invalidate user cache if username/avatar/role changed
	afterUpdate: async (id, data, _existing, env, _origin) => {
		// Check if any cached field was updated
		const cacheFields = ["username", "avatar", "role"];
		const needsInvalidation = cacheFields.some((field) => data[field] !== undefined);
		if (needsInvalidation) {
			await invalidateUserCache(env, id);
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
	const placeholders = ids.map(() => "?").join(",");
	const r = await env.DB.prepare(
		`SELECT id FROM users WHERE id IN (${placeholders}) AND status = -99`,
	)
		.bind(...ids)
		.all();
	return (r.results as { id: number }[]).map((row) => row.id);
}

// ─── #36 GET /api/admin/users ────────────────────────────────────────────────

export const list = withEntityAuth(userConfig, createListHandler(userConfig));

// ─── #37 GET /api/admin/users/:id ────────────────────────────────────────────

export const getById = withEntityAuth(userConfig, createGetByIdHandler(userConfig));

// ─── #38 PATCH /api/admin/users/:id ──────────────────────────────────────────

export const update = withEntityAuth(userConfig, createUpdateHandler(userConfig));

// ─── Content deletion helper (shared by ban + nuke) ──────────────────────────

interface ContentDeletionResult {
	threadsDeleted: number;
	postsDeleted: number;
}

async function deleteUserContent(env: Env, userId: number): Promise<ContentDeletionResult> {
	// 1. Fetch threads, standalone posts (grouped by forum), standalone posts
	// (grouped by thread), and standalone post ids in parallel — all four are
	// independent SELECT-only queries against the same userId. Halves the D1
	// round-trip latency on a heavy admin operation.
	//
	// The standalone post id snapshot must be taken BEFORE the deletion batch
	// runs so that `buildDeletePostChildStatements` can clear FK children
	// (attachments + post_comments) keyed on those post ids — these tables
	// reference posts WITHOUT ON DELETE CASCADE, and embedding a SELECT
	// against `posts` inside the same batch would see post-delete state.
	const [threads, standalonePosts, standaloneThreadUpdates, standalonePostIdRows] =
		await Promise.all([
			env.DB.prepare("SELECT id, forum_id, replies FROM threads WHERE author_id = ?")
				.bind(userId)
				.all(),
			env.DB.prepare(
				"SELECT forum_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY forum_id",
			)
				.bind(userId, userId)
				.all(),
			env.DB.prepare(
				"SELECT thread_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY thread_id",
			)
				.bind(userId, userId)
				.all(),
			env.DB.prepare(
				"SELECT id FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?)",
			)
				.bind(userId, userId)
				.all<{ id: number }>(),
		]);
	const threadRows = threads.results as { id: number; forum_id: number; replies: number }[];
	const userThreadIds = threadRows.map((t) => t.id);
	const standalonePostIds = standalonePostIdRows.results.map((r) => r.id);

	// 2. Group forum impact from user's threads (thread count + all posts in those threads)
	const forumThreadCounts = new Map<number, number>();
	const forumPostCounts = new Map<number, number>();
	for (const t of threadRows) {
		forumThreadCounts.set(t.forum_id, (forumThreadCounts.get(t.forum_id) ?? 0) + 1);
		forumPostCounts.set(t.forum_id, (forumPostCounts.get(t.forum_id) ?? 0) + t.replies + 1);
	}

	const standaloneRows = standalonePosts.results as { forum_id: number; cnt: number }[];
	const standaloneThreadRows = standaloneThreadUpdates.results as {
		thread_id: number;
		cnt: number;
	}[];

	// 5. Collateral damage: other users' posts in the user's threads
	// These posts will be deleted too, so we need to decrement those authors' post counts
	const collateralAuthorCounts = new Map<number, number>();
	if (threadRows.length > 0) {
		const threadIds = threadRows.map((t) => t.id);
		const placeholders = threadIds.map(() => "?").join(",");
		const collateralPosts = await env.DB.prepare(
			`SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN (${placeholders}) AND author_id != ? GROUP BY author_id`,
		)
			.bind(...threadIds, userId)
			.all();
		for (const row of collateralPosts.results as { author_id: number; cnt: number }[]) {
			collateralAuthorCounts.set(row.author_id, row.cnt);
		}
	}

	// Build batch
	const statements: D1PreparedStatement[] = [];

	// Purge FK children (attachments + post_comments) BEFORE the parent
	// posts/threads go away. Neither child column is ON DELETE CASCADE, so
	// any DELETE FROM posts/threads here without these prefixes raises a
	// FOREIGN KEY constraint failure (500). Keyed on snapshot ids gathered
	// above — never sub-query the same tables we're mutating in this batch.
	statements.push(...buildDeleteThreadChildStatements(env, userThreadIds));
	statements.push(...buildDeletePostChildStatements(env, standalonePostIds));

	// Delete all posts in user's threads (cascade)
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(t.id));
	}

	// Delete user's threads
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(t.id));
	}

	// Delete user's standalone posts (replies in other threads). Use the
	// snapshot ids — the previous form
	// `WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads ...)`
	// re-evaluates the sub-query against `threads` AFTER this same batch has
	// already deleted the user's threads, drifting the parent delete set away
	// from the snapshot the FK child purge above was keyed on. Snapshot id
	// IN (...) is the only form that keeps both contracts identical.
	if (standalonePostIds.length > 0) {
		const ph = standalonePostIds.map(() => "?").join(",");
		statements.push(
			env.DB.prepare(`DELETE FROM posts WHERE id IN (${ph})`).bind(...standalonePostIds),
		);
	}

	// Update thread reply counts for affected threads
	for (const row of standaloneThreadRows) {
		statements.push(
			env.DB.prepare("UPDATE threads SET replies = replies - ? WHERE id = ?").bind(
				row.cnt,
				row.thread_id,
			),
		);
	}

	// Update forum counts for deleted threads
	for (const [forumId, threadCount] of forumThreadCounts) {
		const postCount = forumPostCounts.get(forumId) ?? 0;
		statements.push(
			env.DB.prepare(
				"UPDATE forums SET threads = threads - ?, posts = posts - ? WHERE id = ?",
			).bind(threadCount, postCount, forumId),
		);
	}

	// Update forum counts for standalone posts
	for (const row of standaloneRows) {
		statements.push(
			env.DB.prepare("UPDATE forums SET posts = posts - ? WHERE id = ?").bind(
				row.cnt,
				row.forum_id,
			),
		);
	}

	if (statements.length > 0) {
		await env.DB.batch(statements);
	}

	// Recalc metadata for all affected forums and threads
	const allAffectedForumIds = new Set<number>();
	for (const forumId of forumThreadCounts.keys()) {
		allAffectedForumIds.add(forumId);
	}
	for (const row of standaloneRows) {
		allAffectedForumIds.add(row.forum_id);
	}
	// Recalc forum + thread metadata for everything affected, in parallel.
	await Promise.all([
		...Array.from(allAffectedForumIds, (forumId) => recalcForumMetadata(env, forumId)),
		...standaloneThreadRows.map((row) => recalcThreadMetadata(env, row.thread_id)),
	]);

	// Decrement collateral authors' post counts (other users' posts in deleted threads)
	await batchDecrementUserPosts(env, collateralAuthorCounts);

	const totalPostsDeleted =
		threadRows.reduce((sum, t) => sum + t.replies + 1, 0) +
		standaloneRows.reduce((sum, r) => sum + r.cnt, 0);

	return {
		threadsDeleted: threadRows.length,
		postsDeleted: totalPostsDeleted,
	};
}

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
			// Simple ban — status update + audit log are independent.
			await Promise.all([
				env.DB.prepare("UPDATE users SET status = -1 WHERE id = ?").bind(id).run(),
				writeAdminLog(env, resolveActor(request), {
					action: "user.ban",
					targetType: "user",
					targetId: id,
					details: { mode: "ban", deletedContent: false },
				}),
			]);
			return jsonResponse({ banned: true, id, contentDeleted: false }, origin);
		}

		// Ban + delete all content
		const result = await deleteUserContent(env, id);

		// Status update + audit log are independent.
		await Promise.all([
			env.DB.prepare("UPDATE users SET status = -1, threads = 0, posts = 0 WHERE id = ?")
				.bind(id)
				.run(),
			writeAdminLog(env, resolveActor(request), {
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
		]);

		return jsonResponse(
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

		// Status UPDATE + audit log are independent.
		await Promise.all([
			env.DB.prepare("UPDATE users SET status = 0 WHERE id = ?").bind(id).run(),
			writeAdminLog(env, resolveActor(request), {
				action: "user.unban",
				targetType: "user",
				targetId: id,
				details: { previousStatus: existing.status },
			}),
		]);

		return jsonResponse({ unbanned: true, id, previousStatus: existing.status }, origin);
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
		const result = await deleteUserContent(env, id);

		// User-counter zeroing UPDATE, volatile-cache invalidation, and the
		// audit-log write are all independent. Fan out.
		await Promise.all([
			env.DB.prepare(
				"UPDATE users SET status = -1, threads = 0, posts = 0, credits = 0 WHERE id = ?",
			)
				.bind(id)
				.run(),
			invalidateForumVolatile(env),
			writeAdminLog(env, resolveActor(request), {
				action: "user.nuke",
				targetType: "user",
				targetId: id,
				details: {
					deletedThreads: result.threadsDeleted,
					deletedPosts: result.postsDeleted,
				},
			}),
		]);

		return jsonResponse(
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
//   - DB cleanup + counter repair + tombstone in a single env.DB.batch().
//   - After DB batch: recalcThreadMetadata / recalcForumMetadata for affected
//     rows (failures throw — endpoint returns 500; R2 not yet attempted).
//   - After recalc + invalidateForumVolatile: best-effort R2 deletes (avatar +
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
//   { confirmUsername: string }    — must equal target.username
//
// Guards (in order):
//   INVALID_BODY        bad JSON or missing/empty confirmUsername
//   USER_NOT_FOUND      target id missing
//   CONFIRM_MISMATCH    confirmUsername != target.username
//   CANNOT_PURGE_STAFF  target.role > 0
//   ALREADY_PURGED      target.status === -99
//
// Failure semantics:
//   - DB batch failure → 500. Nothing else runs. SQLite rolls back the batch.
//   - recalcMetadata failure → 500. DB is already committed; R2 NOT touched.
//     Operator must re-run /api/admin/users/:id/recalc-counters or related
//     repair tools. Log line tags the affected ids.
//   - R2 failures → 200 with response.r2.failed[] populated. DB is the source
//     of truth; orphan R2 objects can be cleaned by a future GC pass.

interface PurgeOwnedThread {
	id: number;
	forum_id: number;
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
	commentCount: number;
	attachmentCount: number;
	messageCount: number;
}

async function parsePurgeBody(
	request: Request,
): Promise<{ ok: true; confirmUsername: string } | { ok: false; res: Response }> {
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
				{ message: "purge requires { confirmUsername } body" },
				origin,
			),
		};
	}
	const confirmUsername = body.confirmUsername;
	if (typeof confirmUsername !== "string" || confirmUsername.length === 0) {
		return {
			ok: false,
			res: errorResponse(
				"INVALID_BODY",
				400,
				{ message: "confirmUsername must be a non-empty string" },
				origin,
			),
		};
	}
	return { ok: true, confirmUsername };
}

function checkPurgeGuards(
	target: PurgeTarget | null,
	confirmUsername: string,
	origin: string | undefined,
): Response | null {
	if (!target) return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	if (target.username !== confirmUsername)
		return errorResponse("CONFIRM_MISMATCH", 400, undefined, origin);
	if (target.role > 0) return errorResponse("CANNOT_PURGE_STAFF", 403, undefined, origin);
	if (target.status === -99) return errorResponse("ALREADY_PURGED", 409, undefined, origin);
	return null;
}

async function fetchStandalonePosts(
	env: Env,
	id: number,
	ownedThreadIds: number[],
): Promise<PurgeStandalonePost[]> {
	if (ownedThreadIds.length > 0) {
		const ph = ownedThreadIds.map(() => "?").join(",");
		const r = await env.DB.prepare(
			`SELECT id, thread_id, forum_id FROM posts WHERE author_id = ? AND thread_id NOT IN (${ph})`,
		)
			.bind(id, ...ownedThreadIds)
			.all();
		return r.results as unknown as PurgeStandalonePost[];
	}
	const r = await env.DB.prepare("SELECT id, thread_id, forum_id FROM posts WHERE author_id = ?")
		.bind(id)
		.all();
	return r.results as unknown as PurgeStandalonePost[];
}

// Builds a 3-way OR clause covering rows authored by the target plus rows
// that hang off content being deleted. Used for `attachments` and
// `post_comments` so the target's own contributions in survivor threads
// (where they neither own the thread nor wrote a deleted post) still get
// removed. Always returns a clause — `author_id = ?` alone is a valid
// shape even when no posts/threads are being deleted.
function buildAuthorContentWhere(
	authorId: number,
	allDeletedPostIds: number[],
	ownedThreadIds: number[],
): { where: string; binds: unknown[] } {
	const parts: string[] = ["author_id = ?"];
	const binds: unknown[] = [authorId];
	if (allDeletedPostIds.length > 0) {
		parts.push(`post_id IN (${allDeletedPostIds.map(() => "?").join(",")})`);
		binds.push(...allDeletedPostIds);
	}
	if (ownedThreadIds.length > 0) {
		parts.push(`thread_id IN (${ownedThreadIds.map(() => "?").join(",")})`);
		binds.push(...ownedThreadIds);
	}
	return { where: parts.join(" OR "), binds };
}

async function purgePreflight(env: Env, id: number): Promise<PurgePreflight> {
	const ownedThreadsRes = await env.DB.prepare(
		"SELECT id, forum_id FROM threads WHERE author_id = ?",
	)
		.bind(id)
		.all();
	const ownedThreads = ownedThreadsRes.results as unknown as PurgeOwnedThread[];
	const ownedThreadIds = ownedThreads.map((t) => t.id);

	let ownedThreadPosts: PurgeOwnedThreadPost[] = [];
	if (ownedThreadIds.length > 0) {
		const ph = ownedThreadIds.map(() => "?").join(",");
		const r = await env.DB.prepare(`SELECT id, author_id FROM posts WHERE thread_id IN (${ph})`)
			.bind(...ownedThreadIds)
			.all();
		ownedThreadPosts = r.results as unknown as PurgeOwnedThreadPost[];
	}
	const standalonePosts = await fetchStandalonePosts(env, id, ownedThreadIds);

	const allDeletedPostIds = [
		...ownedThreadPosts.map((p) => p.id),
		...standalonePosts.map((p) => p.id),
	];
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
		env.DB.prepare(`SELECT DISTINCT file_path FROM attachments WHERE ${attWhere.where}`)
			.bind(...attWhere.binds)
			.all(),
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

	const attachmentKeys = Array.from(
		new Set(
			(r2KeysRes.results as unknown as PurgeAttachment[]).map((a) => a.file_path).filter(Boolean),
		),
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
		const ph = allDeletedPostIds.map(() => "?").join(",");
		stmts.push(env.DB.prepare(`DELETE FROM posts WHERE id IN (${ph})`).bind(...allDeletedPostIds));
	}
	if (ownedThreadIds.length > 0) {
		const ph = ownedThreadIds.map(() => "?").join(",");
		// threads_fts trigger fires automatically on threads delete
		stmts.push(env.DB.prepare(`DELETE FROM threads WHERE id IN (${ph})`).bind(...ownedThreadIds));
	}
	stmts.push(
		env.DB.prepare("DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?").bind(id, id),
	);

	for (const tid of pre.survivorThreadIds) {
		stmts.push(
			env.DB.prepare(
				`UPDATE threads
				   SET replies = (
				     SELECT COUNT(*) FROM posts
				      WHERE thread_id = ? AND is_first = 0 AND ${POST_VISIBLE}
				   )
				 WHERE id = ?`,
			).bind(tid, tid),
		);
	}

	for (const fid of pre.affectedForumIds) {
		stmts.push(
			env.DB.prepare(
				`UPDATE forums
				   SET threads = (
				     SELECT COUNT(*) FROM threads WHERE forum_id = ? AND ${THREAD_VISIBLE}
				   ),
				   posts = (
				     SELECT COUNT(*) FROM posts p JOIN threads t ON p.thread_id = t.id
				      WHERE p.forum_id = ? AND ${postVisible("p")} AND ${threadVisible("t")}
				   )
				 WHERE id = ?`,
			).bind(fid, fid, fid),
		);
	}

	for (const [authorId, delta] of pre.collateralAuthorDelta) {
		stmts.push(
			env.DB.prepare("UPDATE users SET posts = MAX(0, posts - ?) WHERE id = ?").bind(
				delta,
				authorId,
			),
		);
	}

	stmts.push(buildTombstoneStatement(env, id, 0, nowSec));
	return stmts;
}

async function purgeR2Cleanup(
	env: Env,
	keys: string[],
): Promise<{ deletedCount: number; failed: { key: string; error: string }[] }> {
	const failed: { key: string; error: string }[] = [];
	let deletedCount = 0;
	for (const key of keys) {
		try {
			await env.R2.delete(key);
			deletedCount++;
		} catch (err) {
			failed.push({
				key,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return { deletedCount, failed };
}

async function runPurgeRecalc(env: Env, pre: PurgePreflight): Promise<void> {
	// Survivor-thread + affected-forum recalcs are independent — fan out.
	await Promise.all([
		...pre.survivorThreadIds.map((tid) => recalcThreadMetadata(env, tid)),
		...Array.from(pre.affectedForumIds, (fid) => recalcForumMetadata(env, fid)),
	]);
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
		const guard = checkPurgeGuards(existing, parsed.confirmUsername, origin);
		if (guard) return guard;
		// existing is non-null past the guard
		const target = existing as PurgeTarget;

		const pre = await purgePreflight(env, id);
		const nowSec = Math.floor(Date.now() / 1000);
		const stmts = buildPurgeBatch(env, id, pre, nowSec);

		try {
			await env.DB.batch(stmts);
		} catch (err) {
			console.error("[purge] DB batch failed", { userId: id, err });
			return errorResponse(
				"PURGE_DB_FAILED",
				500,
				{ message: "DB cleanup batch failed; nothing was committed" },
				origin,
			);
		}

		try {
			await runPurgeRecalc(env, pre);
		} catch (err) {
			console.error("[purge] recalcMetadata failed AFTER tombstone committed", {
				userId: id,
				survivorThreadIds: pre.survivorThreadIds,
				affectedForumIds: pre.affectedForumIds,
				err,
			});
			return errorResponse(
				"PURGE_RECALC_FAILED",
				500,
				{
					message:
						"Tombstone + content cleanup committed; last_post metadata recalc failed. Re-run recalc tools.",
				},
				origin,
			);
		}

		// Cache invalidations are all independent (different keys) — fan out.
		await Promise.all([
			invalidateForumVolatile(env),
			invalidateUserCache(env, id),
			...Array.from(pre.collateralAuthorDelta.keys(), (authorId) =>
				invalidateUserCache(env, authorId),
			),
		]);

		const r2Keys = Array.from(
			new Set([...pre.attachmentKeys, ...(target.avatar_path ? [target.avatar_path] : [])]),
		);
		const r2 = await purgeR2Cleanup(env, r2Keys);

		await writeAdminLog(env, resolveActor(request), {
			action: "user.purge",
			targetType: "user",
			targetId: id,
			details: {
				deletedThreads: pre.ownedThreads.length,
				deletedPosts: pre.allDeletedPostIds.length,
				deletedComments: pre.commentCount,
				deletedAttachments: pre.attachmentCount,
				deletedMessages: pre.messageCount,
				r2DeletedCount: r2.deletedCount,
				r2FailedCount: r2.failed.length,
			},
		});

		return jsonResponse(
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
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);
		const raw = url.searchParams.get("ids");
		if (!raw) {
			return errorResponse("INVALID_REQUEST", 400, { message: "ids query param required" }, origin);
		}

		const ids = raw
			.split(",")
			.map((s) => Number.parseInt(s.trim(), 10))
			.filter((n) => !Number.isNaN(n));

		if (ids.length === 0) {
			return jsonResponse([], origin);
		}
		if (ids.length > MAX_BATCH_FETCH) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_BATCH_FETCH} IDs per request` },
				origin,
			);
		}

		const placeholders = ids.map(() => "?").join(",");
		const result = await env.DB.prepare(
			`SELECT ${USER_COLUMNS} FROM users WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.all();

		return jsonResponse(
			result.results.map((r) => toUser(r as Record<string, unknown>)),
			origin,
		);
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
			return jsonResponse({ updated: true, count: 0 }, origin);
		}

		// D4-b: refuse if any target is already tombstoned. Whole batch fails
		// — never silently skip; admin must explicitly drop the tombstoned ids.
		const tombstoned = await fetchTombstoneIds(env, ids);
		if (tombstoned.length > 0) {
			return errorResponse("ALREADY_PURGED", 409, { tombstoneIds: tombstoned }, origin);
		}

		const placeholders = ids.map(() => "?").join(",");
		await env.DB.prepare(`UPDATE users SET status = ? WHERE id IN (${placeholders})`)
			.bind(body.status, ...ids)
			.run();

		return jsonResponse({ updated: true, count: ids.length }, origin);
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
			return jsonResponse({ updated: true, count: 0 }, origin);
		}

		// D4-b: ALREADY_PURGED guard — same shape as batchStatus.
		const tombstoned = await fetchTombstoneIds(env, ids);
		if (tombstoned.length > 0) {
			return errorResponse("ALREADY_PURGED", 409, { tombstoneIds: tombstoned }, origin);
		}

		const placeholders = ids.map(() => "?").join(",");
		await env.DB.prepare(`UPDATE users SET role = ? WHERE id IN (${placeholders})`)
			.bind(body.role, ...ids)
			.run();

		return jsonResponse({ updated: true, count: ids.length }, origin);
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
		await env.DB.prepare("UPDATE users SET threads = ?, posts = ?, digest_posts = ? WHERE id = ?")
			.bind(threads, posts, digestPosts, id)
			.run();

		return jsonResponse({ id, threads, posts, digestPosts }, origin);
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
			userIds = result.results.map((r) => (r as { id: number }).id);
		}

		if (userIds.length === 0) {
			return jsonResponse({ updated: 0 }, origin);
		}

		// Batch recalculate: for each user, compute counts and update
		// Three GROUP BY counts (threads/posts/digests) are independent
		// reads keyed on the same user-id list. Run via Promise.all to halve
		// the round-trip cost of this admin recalculation.
		const placeholders = userIds.map(() => "?").join(",");

		const [threadCounts, postCounts, digestCounts] = await Promise.all([
			env.DB.prepare(
				`SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (${placeholders}) GROUP BY author_id`,
			)
				.bind(...userIds)
				.all(),
			env.DB.prepare(
				`SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN (${placeholders}) GROUP BY author_id`,
			)
				.bind(...userIds)
				.all(),
			env.DB.prepare(
				`SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (${placeholders}) AND digest > 0 GROUP BY author_id`,
			)
				.bind(...userIds)
				.all(),
		]);

		const threadMap = new Map(
			threadCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);
		const postMap = new Map(
			postCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);
		const digestMap = new Map(
			digestCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Batch update all users
		const statements = userIds.map((uid) =>
			env.DB.prepare("UPDATE users SET threads = ?, posts = ?, digest_posts = ? WHERE id = ?").bind(
				threadMap.get(uid) ?? 0,
				postMap.get(uid) ?? 0,
				digestMap.get(uid) ?? 0,
				uid,
			),
		);

		await env.DB.batch(statements);

		return jsonResponse({ updated: userIds.length }, origin);
	},
);

// ─── GET /api/admin/users/staff ─────────────────────────────────────────────
// List all staff users (role > 0: Moderator, SuperMod, Admin).
// Returns simplified list sorted by role (Admin first) then username.

export const listStaff = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		// role: 0=User, 1=Admin, 2=SuperMod, 3=Moderator
		// Staff = role > 0
		const result = await env.DB.prepare(
			`SELECT ${USER_COLUMNS} FROM users WHERE role > 0 ORDER BY role ASC, username ASC`,
		).all();

		return jsonResponse(
			result.results.map((r) => toUser(r as Record<string, unknown>)),
			origin,
		);
	},
);

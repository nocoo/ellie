import { withEntityAuth } from "../../lib/adminHelpers";
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
// Admin user handlers (#36-#42) — CRUD framework + custom actions
import { errorResponse } from "../../middleware/error";

// ─── Column list (never SELECT * — excludes password_hash, password_salt) ────

const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity, email_verified_at, email_normalized, email_changed_at, reg_ip, last_ip";

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

	// #38 beforeUpdate: username uniqueness
	beforeUpdate: async (id, data, _existing, env, origin) => {
		// Username uniqueness check
		if (data.username !== undefined) {
			const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id != ?")
				.bind(data.username, id)
				.first();
			if (existing) {
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
	// 1. Get user's threads to calculate forum impact
	const threads = await env.DB.prepare(
		"SELECT id, forum_id, replies FROM threads WHERE author_id = ?",
	)
		.bind(userId)
		.all();
	const threadRows = threads.results as { id: number; forum_id: number; replies: number }[];

	// 2. Group forum impact from user's threads (thread count + all posts in those threads)
	const forumThreadCounts = new Map<number, number>();
	const forumPostCounts = new Map<number, number>();
	for (const t of threadRows) {
		forumThreadCounts.set(t.forum_id, (forumThreadCounts.get(t.forum_id) ?? 0) + 1);
		forumPostCounts.set(t.forum_id, (forumPostCounts.get(t.forum_id) ?? 0) + t.replies + 1);
	}

	// 3. Count standalone posts (replies in other users' threads) grouped by forum
	const standalonePosts = await env.DB.prepare(
		"SELECT forum_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY forum_id",
	)
		.bind(userId, userId)
		.all();
	const standaloneRows = standalonePosts.results as { forum_id: number; cnt: number }[];

	// 4. Standalone post counts grouped by thread (for reply counter updates)
	const standaloneThreadUpdates = await env.DB.prepare(
		"SELECT thread_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY thread_id",
	)
		.bind(userId, userId)
		.all();
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

	// Delete all posts in user's threads (cascade)
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(t.id));
	}

	// Delete user's threads
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(t.id));
	}

	// Delete user's standalone posts (replies in other threads)
	statements.push(
		env.DB.prepare(
			"DELETE FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?)",
		).bind(userId, userId),
	);

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
	for (const forumId of allAffectedForumIds) {
		await recalcForumMetadata(env, forumId);
	}
	for (const row of standaloneThreadRows) {
		await recalcThreadMetadata(env, row.thread_id);
	}

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

		// Verify user exists
		const existing = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
		if (!existing) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
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
			// Simple ban — just set status to -1
			await env.DB.prepare("UPDATE users SET status = -1 WHERE id = ?").bind(id).run();
			return jsonResponse({ banned: true, id, contentDeleted: false }, origin);
		}

		// Ban + delete all content
		const result = await deleteUserContent(env, id);

		// Update user: ban + zero counters
		await env.DB.prepare("UPDATE users SET status = -1, threads = 0, posts = 0 WHERE id = ?")
			.bind(id)
			.run();

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

// ─── #40 POST /api/admin/users/:id/nuke ──────────────────────────────────────

export const nuke = withEntityAuth(
	userConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		// Verify user exists
		const existing = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
		if (!existing) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}

		// Nuke = ban + delete content + zero credits (always deletes content)
		const result = await deleteUserContent(env, id);

		// Update user: ban + zero all counters + zero credits
		await env.DB.prepare(
			"UPDATE users SET status = -1, threads = 0, posts = 0, credits = 0 WHERE id = ?",
		)
			.bind(id)
			.run();

		// Invalidate volatile cache (massive counts change from content deletion)
		await invalidateForumVolatile(env);

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

		// Verify user exists
		const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
		if (!user) {
			return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
		}

		// Count threads authored by user
		const threadsRow = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM threads WHERE author_id = ?",
		)
			.bind(id)
			.first<{ cnt: number }>();

		// Count posts authored by user
		const postsRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM posts WHERE author_id = ?")
			.bind(id)
			.first<{ cnt: number }>();

		// Count digest threads authored by user
		const digestRow = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM threads WHERE author_id = ? AND digest > 0",
		)
			.bind(id)
			.first<{ cnt: number }>();

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
		// Using a single query with GROUP BY for efficiency
		const placeholders = userIds.map(() => "?").join(",");

		// Get thread counts per user
		const threadCounts = await env.DB.prepare(
			`SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (${placeholders}) GROUP BY author_id`,
		)
			.bind(...userIds)
			.all();
		const threadMap = new Map(
			threadCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Get post counts per user
		const postCounts = await env.DB.prepare(
			`SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN (${placeholders}) GROUP BY author_id`,
		)
			.bind(...userIds)
			.all();
		const postMap = new Map(
			postCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Get digest counts per user
		const digestCounts = await env.DB.prepare(
			`SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (${placeholders}) AND digest > 0 GROUP BY author_id`,
		)
			.bind(...userIds)
			.all();
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

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler, createListHandler, createUpdateHandler } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { toUser } from "../../lib/mappers";
import { parsePathSegment } from "../../lib/parseId";
import { recalcForumMetadata, recalcThreadMetadata } from "../../lib/recalcMetadata";
import { jsonResponse } from "../../lib/response";
import { batchDecrementUserPosts } from "../../lib/userCounters";
// Admin user handlers (#36-#42) — CRUD framework + custom actions
import type { AuthUser } from "../../middleware/auth";
import { errorResponse } from "../../middleware/error";

// ─── Column list (never SELECT * — excludes password_hash, password_salt) ────

const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits";

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

	// #38 beforeUpdate: self-protection + username uniqueness
	beforeUpdate: async (id, data, _existing, user, env, origin) => {
		// Self-protection: cannot change own status
		if (data.status !== undefined && id === user.userId) {
			return errorResponse("SELF_BAN", 400, undefined, origin);
		}

		// Self-protection: cannot change own role
		if (data.role !== undefined && id === user.userId) {
			return errorResponse("SELF_ROLE_CHANGE", 400, undefined, origin);
		}

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
	async (request: Request, env: Env, user: AuthUser): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		// Self-protection
		if (id === user.userId) {
			return errorResponse("SELF_BAN", 400, undefined, origin);
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
	async (request: Request, env: Env, user: AuthUser): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parsePathSegment(request, 1);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
		}

		// Self-protection
		if (id === user.userId) {
			return errorResponse("SELF_BAN", 400, undefined, origin);
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

// ─── #41 POST /api/admin/users/batch-status ──────────────────────────────────

const MAX_BATCH_SIZE = 100;
const VALID_STATUSES = new Set([0, -1, -2]);

export const batchStatus = withEntityAuth(
	userConfig,
	async (request: Request, env: Env, user: AuthUser): Promise<Response> => {
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

		// Parse and validate IDs, auto-exclude current user
		const ids = body.ids
			.map((id) => Number(id))
			.filter((id) => !Number.isNaN(id) && id !== user.userId);

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
	async (request: Request, env: Env, user: AuthUser): Promise<Response> => {
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

		// Parse and validate IDs, auto-exclude current user
		const ids = body.ids
			.map((id) => Number(id))
			.filter((id) => !Number.isNaN(id) && id !== user.userId);

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

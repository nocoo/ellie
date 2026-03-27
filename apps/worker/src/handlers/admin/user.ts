// Admin user handlers for Cloudflare Worker
import { toUser } from "../../lib/mappers";
import { parseIdFromPath, parsePathSegment } from "../../lib/parseId";
import { jsonResponse, paginatedResponse } from "../../lib/response";
import { withAdmin } from "../../lib/routeHelpers";
import { errorResponse } from "../../middleware/error";

const MAX_PAGE_SIZE = 100;

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits";

/** GET /api/admin/users — List/search users with offset pagination */
export const list = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const username = url.searchParams.get("username");
	const email = url.searchParams.get("email");
	const status = url.searchParams.get("status");
	const role = url.searchParams.get("role");

	const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
	const limit = Math.min(
		Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
		MAX_PAGE_SIZE,
	);

	if (page < 1 || Number.isNaN(page)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid page number" }, origin);
	}
	const offset = (page - 1) * limit;

	// Build WHERE clause
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (username) {
		conditions.push("username LIKE ?");
		params.push(`%${username}%`);
	}
	if (email) {
		conditions.push("email LIKE ?");
		params.push(`%${email}%`);
	}
	if (status !== null) {
		const statusNum = Number.parseInt(status, 10);
		if (!Number.isNaN(statusNum)) {
			conditions.push("status = ?");
			params.push(statusNum);
		}
	}
	if (role !== null) {
		const roleNum = Number.parseInt(role, 10);
		if (!Number.isNaN(roleNum)) {
			conditions.push("role = ?");
			params.push(roleNum);
		}
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	// Get total count
	const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM users ${whereClause}`)
		.bind(...params)
		.first<{ total: number }>();
	const total = countResult?.total ?? 0;

	// Get paginated results
	params.push(limit, offset);
	const result = await env.DB.prepare(
		`SELECT ${USER_COLUMNS} FROM users ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
	)
		.bind(...params)
		.all();

	const users = result.results.map((row) => toUser(row as Record<string, unknown>));

	return paginatedResponse(users, total, page, limit, origin);
});

/** GET /api/admin/users/:id — Get full user profile */
export const getById = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	const row = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(id)
		.first();
	if (!row) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toUser(row as Record<string, unknown>), origin);
});

/** PATCH /api/admin/users/:id/status — Ban/unban/archive user */
export const setStatus = withAdmin(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1); // "status" is 1 from end
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Self-protection
	if (id === user.userId) {
		return errorResponse("SELF_BAN", 400, undefined, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (typeof body.status !== "number") {
		return errorResponse("INVALID_BODY", 400, { message: "status is required (number)" }, origin);
	}

	const result = await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?")
		.bind(body.status, id)
		.run();

	if (result.meta.changes === 0) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse({ updated: true, id, status: body.status }, origin);
});

/** PATCH /api/admin/users/:id/role — Change user role */
export const setRole = withAdmin(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1); // "role" is 1 from end
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Self-protection
	if (id === user.userId) {
		return errorResponse("SELF_ROLE_CHANGE", 400, undefined, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (typeof body.role !== "number" || body.role < 0 || body.role > 3) {
		return errorResponse("INVALID_BODY", 400, { message: "role must be 0-3" }, origin);
	}

	const result = await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?")
		.bind(body.role, id)
		.run();

	if (result.meta.changes === 0) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse({ updated: true, id, role: body.role }, origin);
});

/** POST /api/admin/users/:id/ban — Ban user + optionally delete all content */
export const ban = withAdmin(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1); // "ban" is 1 from end
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Self-protection
	if (id === user.userId) {
		return errorResponse("SELF_BAN", 400, undefined, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		// Body is optional for ban
		body = {};
	}

	const deleteContent = body.deleteContent === true;

	// Verify user exists
	const existing = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
	if (!existing) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	if (!deleteContent) {
		// Simple ban — just set status to -1
		await env.DB.prepare("UPDATE users SET status = -1 WHERE id = ?").bind(id).run();
		return jsonResponse({ banned: true, id, contentDeleted: false }, origin);
	}

	// Ban + delete all content
	// 1. Get user's threads to update forum counts
	const threads = await env.DB.prepare(
		"SELECT id, forum_id, replies FROM threads WHERE author_id = ?",
	)
		.bind(id)
		.all();
	const threadRows = threads.results as { id: number; forum_id: number; replies: number }[];

	// 2. Group forum impact from threads
	const forumThreadCounts = new Map<number, number>();
	const forumPostCounts = new Map<number, number>();
	for (const t of threadRows) {
		forumThreadCounts.set(t.forum_id, (forumThreadCounts.get(t.forum_id) ?? 0) + 1);
		forumPostCounts.set(t.forum_id, (forumPostCounts.get(t.forum_id) ?? 0) + t.replies + 1);
	}

	// 3. Count standalone posts (not in user's own threads) grouped by forum
	const standalonePosts = await env.DB.prepare(
		"SELECT forum_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY forum_id",
	)
		.bind(id, id)
		.all();
	const standaloneRows = standalonePosts.results as { forum_id: number; cnt: number }[];

	// Also need to update thread reply counts for standalone posts
	const standaloneThreadUpdates = await env.DB.prepare(
		"SELECT thread_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY thread_id",
	)
		.bind(id, id)
		.all();
	const standaloneThreadRows = standaloneThreadUpdates.results as {
		thread_id: number;
		cnt: number;
	}[];

	// Build batch
	const statements: D1PreparedStatement[] = [];

	// Ban the user + zero counters
	statements.push(
		env.DB.prepare("UPDATE users SET status = -1, threads = 0, posts = 0 WHERE id = ?").bind(id),
	);

	// Delete all posts in user's threads
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(t.id));
	}

	// Delete user's threads
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(t.id));
	}

	// Delete user's standalone posts
	statements.push(
		env.DB.prepare(
			"DELETE FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?)",
		).bind(id, id),
	);

	// Update thread reply counts for standalone posts
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

	await env.DB.batch(statements);

	return jsonResponse(
		{
			banned: true,
			id,
			contentDeleted: true,
			threadsDeleted: threadRows.length,
			postsDeleted:
				threadRows.reduce((sum, t) => sum + t.replies + 1, 0) +
				standaloneRows.reduce((sum, r) => sum + r.cnt, 0),
		},
		origin,
	);
});

/** POST /api/admin/users/:id/nuke — Ban + delete ALL content + zero credits */
export const nuke = withAdmin(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1); // "nuke" is 1 from end
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

	// 1. Get user's threads
	const threads = await env.DB.prepare(
		"SELECT id, forum_id, replies FROM threads WHERE author_id = ?",
	)
		.bind(id)
		.all();
	const threadRows = threads.results as { id: number; forum_id: number; replies: number }[];

	// 2. Group forum impact from threads
	const forumThreadCounts = new Map<number, number>();
	const forumPostCounts = new Map<number, number>();
	for (const t of threadRows) {
		forumThreadCounts.set(t.forum_id, (forumThreadCounts.get(t.forum_id) ?? 0) + 1);
		forumPostCounts.set(t.forum_id, (forumPostCounts.get(t.forum_id) ?? 0) + t.replies + 1);
	}

	// 3. Count standalone posts grouped by forum
	const standalonePosts = await env.DB.prepare(
		"SELECT forum_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY forum_id",
	)
		.bind(id, id)
		.all();
	const standaloneRows = standalonePosts.results as { forum_id: number; cnt: number }[];

	// 4. Standalone thread reply updates
	const standaloneThreadUpdates = await env.DB.prepare(
		"SELECT thread_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY thread_id",
	)
		.bind(id, id)
		.all();
	const standaloneThreadRows = standaloneThreadUpdates.results as {
		thread_id: number;
		cnt: number;
	}[];

	// Build batch
	const statements: D1PreparedStatement[] = [];

	// Nuke user: ban + zero all counters + zero credits
	statements.push(
		env.DB.prepare(
			"UPDATE users SET status = -1, threads = 0, posts = 0, credits = 0 WHERE id = ?",
		).bind(id),
	);

	// Delete all posts in user's threads
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(t.id));
	}

	// Delete user's threads
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(t.id));
	}

	// Delete user's standalone posts
	statements.push(
		env.DB.prepare(
			"DELETE FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?)",
		).bind(id, id),
	);

	// Update thread reply counts for standalone posts
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

	await env.DB.batch(statements);

	const totalPostsDeleted =
		threadRows.reduce((sum, t) => sum + t.replies + 1, 0) +
		standaloneRows.reduce((sum, r) => sum + r.cnt, 0);

	return jsonResponse(
		{
			nuked: true,
			id,
			threadsDeleted: threadRows.length,
			postsDeleted: totalPostsDeleted,
		},
		origin,
	);
});

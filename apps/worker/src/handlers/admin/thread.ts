import { toThread } from "../../lib/mappers";
import { parseIdFromPath, parsePathSegment } from "../../lib/parseId";
import { jsonResponse, paginatedResponse } from "../../lib/response";
import { withModerator } from "../../lib/routeHelpers";
import { errorResponse } from "../../middleware/error";

const MAX_PAGE_SIZE = 100;
const MAX_BATCH_SIZE = 100;

/** GET /api/admin/threads — List threads with filters and offset pagination */
export const list = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const forumId = url.searchParams.get("forumId");
	const authorId = url.searchParams.get("authorId");
	const authorName = url.searchParams.get("authorName");
	const subject = url.searchParams.get("subject");
	const sticky = url.searchParams.get("sticky");
	const closed = url.searchParams.get("closed");

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

	if (forumId) {
		const forumIdNum = Number.parseInt(forumId, 10);
		if (!Number.isNaN(forumIdNum)) {
			conditions.push("forum_id = ?");
			params.push(forumIdNum);
		}
	}
	if (authorId) {
		const authorIdNum = Number.parseInt(authorId, 10);
		if (!Number.isNaN(authorIdNum)) {
			conditions.push("author_id = ?");
			params.push(authorIdNum);
		}
	}
	if (authorName) {
		conditions.push("author_name LIKE ?");
		params.push(`%${authorName}%`);
	}
	if (subject) {
		conditions.push("subject LIKE ?");
		params.push(`%${subject}%`);
	}
	if (sticky !== null) {
		const stickyNum = Number.parseInt(sticky, 10);
		if (!Number.isNaN(stickyNum)) {
			conditions.push("sticky = ?");
			params.push(stickyNum);
		}
	}
	if (closed !== null) {
		const closedNum = Number.parseInt(closed, 10);
		if (!Number.isNaN(closedNum)) {
			conditions.push("closed = ?");
			params.push(closedNum);
		}
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	// Get total count
	const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM threads ${whereClause}`)
		.bind(...params)
		.first<{ total: number }>();
	const total = countResult?.total ?? 0;

	// Get paginated results
	params.push(limit, offset);
	const result = await env.DB.prepare(
		`SELECT * FROM threads ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
	)
		.bind(...params)
		.all();

	const threads = result.results.map((row) => toThread(row as Record<string, unknown>));

	return paginatedResponse(threads, total, page, limit, origin);
});

/** GET /api/admin/threads/:id — Get thread by ID */
export const getById = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	const row = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(id).first();
	if (!row) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toThread(row as Record<string, unknown>), origin);
});

/** DELETE /api/admin/threads/:id — Delete thread + cascade posts */
export const remove = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	// Fetch thread to get forum_id and reply count
	const thread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(id).first();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const threadRow = thread as { forum_id: number; replies: number };
	const postCount = threadRow.replies + 1; // replies + first post

	// Batch: delete posts, delete thread, update forum counts
	await env.DB.batch([
		env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
		env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?").bind(
			postCount,
			threadRow.forum_id,
		),
	]);

	return jsonResponse({ deleted: true, id, postsDeleted: postCount }, origin);
});

/** PATCH /api/admin/threads/:id/sticky — Set sticky level */
export const setSticky = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1); // "sticky" is 1 from end
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (typeof body.level !== "number" || body.level < 0 || body.level > 3) {
		return errorResponse("INVALID_BODY", 400, { message: "level must be 0-3" }, origin);
	}

	const result = await env.DB.prepare("UPDATE threads SET sticky = ? WHERE id = ?")
		.bind(body.level, id)
		.run();

	if (result.meta.changes === 0) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse({ updated: true, id, sticky: body.level }, origin);
});

/** PATCH /api/admin/threads/:id/digest — Set digest level */
export const setDigest = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (typeof body.level !== "number" || body.level < 0 || body.level > 3) {
		return errorResponse("INVALID_BODY", 400, { message: "level must be 0-3" }, origin);
	}

	const result = await env.DB.prepare("UPDATE threads SET digest = ? WHERE id = ?")
		.bind(body.level, id)
		.run();

	if (result.meta.changes === 0) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse({ updated: true, id, digest: body.level }, origin);
});

/** PATCH /api/admin/threads/:id/close — Open/close thread */
export const setClosed = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (typeof body.closed !== "number" && typeof body.closed !== "boolean") {
		return errorResponse("INVALID_BODY", 400, { message: "closed must be 0/1 or boolean" }, origin);
	}

	const closedValue = body.closed === true || body.closed === 1 ? 1 : 0;

	const result = await env.DB.prepare("UPDATE threads SET closed = ? WHERE id = ?")
		.bind(closedValue, id)
		.run();

	if (result.meta.changes === 0) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse({ updated: true, id, closed: closedValue }, origin);
});

/** PATCH /api/admin/threads/:id/move — Move thread to different forum */
export const move = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (typeof body.forumId !== "number") {
		return errorResponse("INVALID_BODY", 400, { message: "forumId is required" }, origin);
	}

	// Fetch thread
	const thread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(id).first();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const threadRow = thread as { forum_id: number; replies: number };

	// Can't move to same forum
	if (threadRow.forum_id === body.forumId) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "Thread is already in this forum" },
			origin,
		);
	}

	// Validate target forum exists
	const targetForum = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
		.bind(body.forumId)
		.first();
	if (!targetForum) {
		return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
	}

	const postCount = threadRow.replies + 1;

	// Batch: update thread, update all posts, adjust both forum counts
	await env.DB.batch([
		env.DB.prepare("UPDATE threads SET forum_id = ? WHERE id = ?").bind(body.forumId, id),
		env.DB.prepare("UPDATE posts SET forum_id = ? WHERE thread_id = ?").bind(body.forumId, id),
		env.DB.prepare("UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?").bind(
			postCount,
			threadRow.forum_id,
		),
		env.DB.prepare("UPDATE forums SET threads = threads + 1, posts = posts + ? WHERE id = ?").bind(
			postCount,
			body.forumId,
		),
	]);

	return jsonResponse(
		{ moved: true, id, fromForumId: threadRow.forum_id, toForumId: body.forumId },
		origin,
	);
});

/** POST /api/admin/threads/batch-delete — Batch delete threads */
export const batchDelete = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	if (!Array.isArray(body.ids)) {
		return errorResponse("INVALID_BODY", 400, { message: "ids must be an array" }, origin);
	}

	if (body.ids.length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "ids cannot be empty" }, origin);
	}

	if (body.ids.length > MAX_BATCH_SIZE) {
		return errorResponse(
			"BATCH_LIMIT_EXCEEDED",
			400,
			{ message: `Max ${MAX_BATCH_SIZE} threads` },
			origin,
		);
	}

	// Validate all IDs are numbers
	const ids = body.ids.map((id) => Number.parseInt(id as string, 10));
	if (ids.some((id) => Number.isNaN(id))) {
		return errorResponse("INVALID_BODY", 400, { message: "All ids must be numbers" }, origin);
	}

	// Fetch all threads to get forum_ids and post counts
	const placeholders = ids.map(() => "?").join(",");
	const threads = await env.DB.prepare(
		`SELECT id, forum_id, replies FROM threads WHERE id IN (${placeholders})`,
	)
		.bind(...ids)
		.all();

	const threadRows = threads.results as { id: number; forum_id: number; replies: number }[];

	if (threadRows.length === 0) {
		return errorResponse("THREAD_NOT_FOUND", 404, { message: "No threads found" }, origin);
	}

	// Group by forum for count updates
	const forumUpdates = new Map<number, number>();
	for (const t of threadRows) {
		const postCount = t.replies + 1;
		forumUpdates.set(t.forum_id, (forumUpdates.get(t.forum_id) ?? 0) + postCount);
	}

	// Build batch statements
	const statements: D1PreparedStatement[] = [];
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(t.id));
	}
	for (const t of threadRows) {
		statements.push(env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(t.id));
	}
	for (const [forumId, postCount] of forumUpdates) {
		const threadCount = threadRows.filter((t) => t.forum_id === forumId).length;
		statements.push(
			env.DB.prepare(
				"UPDATE forums SET threads = threads - ?, posts = posts - ? WHERE id = ?",
			).bind(threadCount, postCount, forumId),
		);
	}

	await env.DB.batch(statements);

	return jsonResponse({ deleted: true, count: threadRows.length }, origin);
});

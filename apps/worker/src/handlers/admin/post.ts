import { toPost } from "../../lib/mappers";
// Admin post handlers for Cloudflare Worker
import { parseIdFromPath } from "../../lib/parseId";
import { jsonResponse, paginatedResponse } from "../../lib/response";
import { withModerator } from "../../lib/routeHelpers";
import { errorResponse } from "../../middleware/error";

const MAX_PAGE_SIZE = 100;
const MAX_BATCH_SIZE = 100;

/** GET /api/admin/posts — List posts with filters and offset pagination */
export const list = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const threadId = url.searchParams.get("threadId");
	const authorId = url.searchParams.get("authorId");
	const authorName = url.searchParams.get("authorName");
	const content = url.searchParams.get("content");

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

	if (threadId) {
		const threadIdNum = Number.parseInt(threadId, 10);
		if (!Number.isNaN(threadIdNum)) {
			conditions.push("thread_id = ?");
			params.push(threadIdNum);
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
	if (content) {
		conditions.push("content LIKE ?");
		params.push(`%${content}%`);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	// Get total count
	const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM posts ${whereClause}`)
		.bind(...params)
		.first<{ total: number }>();
	const total = countResult?.total ?? 0;

	// Get paginated results
	params.push(limit, offset);
	const result = await env.DB.prepare(
		`SELECT * FROM posts ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
	)
		.bind(...params)
		.all();

	const posts = result.results.map((row) => toPost(row as Record<string, unknown>));

	return paginatedResponse(posts, total, page, limit, origin);
});

/** DELETE /api/admin/posts/:id — Delete post (refuse first post) */
export const remove = withModerator(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	}

	// Fetch post
	const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
	if (!post) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const postRow = post as { thread_id: number; forum_id: number; is_first: number };

	// Guard: cannot delete first post
	if (postRow.is_first === 1) {
		return errorResponse(
			"CANNOT_DELETE_FIRST_POST",
			400,
			{ message: "Cannot delete the first post — delete the thread instead" },
			origin,
		);
	}

	// Batch: delete post, update thread replies, update forum posts
	await env.DB.batch([
		env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ?").bind(postRow.thread_id),
		env.DB.prepare("UPDATE forums SET posts = posts - 1 WHERE id = ?").bind(postRow.forum_id),
	]);

	return jsonResponse({ deleted: true, id }, origin);
});

/** POST /api/admin/posts/batch-delete — Batch delete posts */
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
			{ message: `Max ${MAX_BATCH_SIZE} posts` },
			origin,
		);
	}

	// Validate all IDs are numbers
	const ids = body.ids.map((id) => Number.parseInt(id as string, 10));
	if (ids.some((id) => Number.isNaN(id))) {
		return errorResponse("INVALID_BODY", 400, { message: "All ids must be numbers" }, origin);
	}

	// Fetch all posts to get thread_ids, forum_ids, is_first
	const placeholders = ids.map(() => "?").join(",");
	const posts = await env.DB.prepare(
		`SELECT id, thread_id, forum_id, is_first FROM posts WHERE id IN (${placeholders})`,
	)
		.bind(...ids)
		.all();

	const postRows = posts.results as {
		id: number;
		thread_id: number;
		forum_id: number;
		is_first: number;
	}[];

	// Filter out first posts and report them as skipped
	const deletable = postRows.filter((p) => p.is_first !== 1);
	const skipped = postRows.filter((p) => p.is_first === 1).map((p) => p.id);

	if (deletable.length === 0) {
		return jsonResponse({ deleted: true, count: 0, skipped }, origin);
	}

	// Group by thread and forum for count updates
	const threadUpdates = new Map<number, number>();
	const forumUpdates = new Map<number, number>();

	for (const p of deletable) {
		threadUpdates.set(p.thread_id, (threadUpdates.get(p.thread_id) ?? 0) + 1);
		forumUpdates.set(p.forum_id, (forumUpdates.get(p.forum_id) ?? 0) + 1);
	}

	// Build batch statements
	const statements: D1PreparedStatement[] = [];
	for (const p of deletable) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(p.id));
	}
	for (const [threadId, count] of threadUpdates) {
		statements.push(
			env.DB.prepare("UPDATE threads SET replies = replies - ? WHERE id = ?").bind(count, threadId),
		);
	}
	for (const [forumId, count] of forumUpdates) {
		statements.push(
			env.DB.prepare("UPDATE forums SET posts = posts - ? WHERE id = ?").bind(count, forumId),
		);
	}

	await env.DB.batch(statements);

	return jsonResponse({ deleted: true, count: deletable.length, skipped }, origin);
});

// Admin attachment handlers for Cloudflare Worker
import { toAttachment } from "../../lib/mappers";
import { parseIdFromPath } from "../../lib/parseId";
import { jsonResponse, paginatedResponse } from "../../lib/response";
import { withAdmin } from "../../lib/routeHelpers";
import { errorResponse } from "../../middleware/error";

const MAX_PAGE_SIZE = 100;

/** GET /api/admin/attachments — List attachments with filters and offset pagination */
export const list = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const postId = url.searchParams.get("postId");
	const threadId = url.searchParams.get("threadId");
	const authorId = url.searchParams.get("authorId");
	const isImage = url.searchParams.get("isImage");

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

	if (postId) {
		const num = Number.parseInt(postId, 10);
		if (!Number.isNaN(num)) {
			conditions.push("post_id = ?");
			params.push(num);
		}
	}
	if (threadId) {
		const num = Number.parseInt(threadId, 10);
		if (!Number.isNaN(num)) {
			conditions.push("thread_id = ?");
			params.push(num);
		}
	}
	if (authorId) {
		const num = Number.parseInt(authorId, 10);
		if (!Number.isNaN(num)) {
			conditions.push("author_id = ?");
			params.push(num);
		}
	}
	if (isImage === "true" || isImage === "1") {
		conditions.push("is_image = 1");
	} else if (isImage === "false" || isImage === "0") {
		conditions.push("is_image = 0");
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	// Get total count
	const countResult = await env.DB.prepare(
		`SELECT COUNT(*) as total FROM attachments ${whereClause}`,
	)
		.bind(...params)
		.first<{ total: number }>();
	const total = countResult?.total ?? 0;

	// Get paginated results
	params.push(limit, offset);
	const result = await env.DB.prepare(
		`SELECT * FROM attachments ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
	)
		.bind(...params)
		.all();

	const attachments = result.results.map((row) => toAttachment(row as Record<string, unknown>));

	return paginatedResponse(attachments, total, page, limit, origin);
});

/** DELETE /api/admin/attachments/:id — Delete attachment metadata */
export const remove = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid attachment ID" }, origin);
	}

	const attachment = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
		.bind(id)
		.first();
	if (!attachment) {
		return errorResponse("NOT_FOUND", 404, { message: "Attachment not found" }, origin);
	}

	await env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();

	return jsonResponse({ deleted: true, id }, origin);
});

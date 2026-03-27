// Admin forum handlers for Cloudflare Worker
import { ForumType } from "@ellie/types";
import { toForum } from "../../lib/mappers";
import { parseIdFromPath } from "../../lib/parseId";
import { jsonResponse } from "../../lib/response";
import { withAdmin } from "../../lib/routeHelpers";
import { errorResponse } from "../../middleware/error";

const VALID_FORUM_TYPES = new Set(Object.values(ForumType));

/** GET /api/admin/forums — List all forums (including hidden) */
export const list = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const result = await env.DB.prepare(
		"SELECT * FROM forums ORDER BY parent_id, display_order",
	).all();
	const forums = result.results.map((row) => toForum(row as Record<string, unknown>));
	return jsonResponse(forums, origin);
});

/** GET /api/admin/forums/:id — Get forum by ID (including hidden) */
export const getById = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	const row = await env.DB.prepare("SELECT * FROM forums WHERE id = ?").bind(id).first();
	if (!row) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toForum(row as Record<string, unknown>), origin);
});

/** POST /api/admin/forums — Create a new forum */
export const create = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const name = body.name;
	if (typeof name !== "string" || name.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "name is required" }, origin);
	}
	if (name.length > 100) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "name must be at most 100 characters" },
			origin,
		);
	}

	const type = (body.type as string) ?? "forum";
	if (!VALID_FORUM_TYPES.has(type as ForumType)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid type" }, origin);
	}

	const parentId = typeof body.parentId === "number" ? body.parentId : 0;
	const description = typeof body.description === "string" ? body.description : "";
	const icon = typeof body.icon === "string" ? body.icon : "";
	const displayOrder = typeof body.displayOrder === "number" ? body.displayOrder : 0;
	const status = typeof body.status === "number" ? body.status : 1;

	if (status !== 0 && status !== 1) {
		return errorResponse("INVALID_BODY", 400, { message: "status must be 0 or 1" }, origin);
	}

	// Validate parent exists if non-zero
	if (parentId !== 0) {
		const parent = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
			.bind(parentId)
			.first();
		if (!parent) {
			return errorResponse("INVALID_BODY", 400, { message: "Parent forum not found" }, origin);
		}
	}

	const result = await env.DB.prepare(
		`INSERT INTO forums (parent_id, name, description, icon, display_order, threads, posts, type, status, last_thread_id, last_post_at, last_poster)
		 VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, '')`,
	)
		.bind(parentId, name.trim(), description, icon, displayOrder, type, status)
		.run();

	// Re-fetch the created forum
	const lastId = result.meta.last_row_id;
	const created = await env.DB.prepare("SELECT * FROM forums WHERE id = ?").bind(lastId).first();

	return jsonResponse(toForum(created as Record<string, unknown>), origin, undefined, 201);
});

/** PATCH /api/admin/forums/:id — Update forum */
export const update = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	// Build dynamic SET clause
	const setClauses: string[] = [];
	const params: unknown[] = [];

	if (typeof body.name === "string") {
		if (body.name.trim().length === 0) {
			return errorResponse("INVALID_BODY", 400, { message: "name cannot be empty" }, origin);
		}
		if (body.name.length > 100) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "name must be at most 100 characters" },
				origin,
			);
		}
		setClauses.push("name = ?");
		params.push(body.name.trim());
	}
	if (typeof body.description === "string") {
		setClauses.push("description = ?");
		params.push(body.description);
	}
	if (typeof body.icon === "string") {
		setClauses.push("icon = ?");
		params.push(body.icon);
	}
	if (typeof body.displayOrder === "number") {
		setClauses.push("display_order = ?");
		params.push(body.displayOrder);
	}
	if (typeof body.status === "number") {
		if (body.status !== 0 && body.status !== 1) {
			return errorResponse("INVALID_BODY", 400, { message: "status must be 0 or 1" }, origin);
		}
		setClauses.push("status = ?");
		params.push(body.status);
	}
	if (typeof body.type === "string") {
		if (!VALID_FORUM_TYPES.has(body.type as ForumType)) {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid type" }, origin);
		}
		setClauses.push("type = ?");
		params.push(body.type);
	}
	if (typeof body.parentId === "number") {
		setClauses.push("parent_id = ?");
		params.push(body.parentId);
	}

	if (setClauses.length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "No fields to update" }, origin);
	}

	// Check forum exists
	const existing = await env.DB.prepare("SELECT id FROM forums WHERE id = ?").bind(id).first();
	if (!existing) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	params.push(id);
	await env.DB.prepare(`UPDATE forums SET ${setClauses.join(", ")} WHERE id = ?`)
		.bind(...params)
		.run();

	// Re-fetch updated forum
	const updated = await env.DB.prepare("SELECT * FROM forums WHERE id = ?").bind(id).first();
	return jsonResponse(toForum(updated as Record<string, unknown>), origin);
});

/** DELETE /api/admin/forums/:id — Delete forum (refuses if has threads) */
export const remove = withAdmin(async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	// Check forum exists
	const existing = await env.DB.prepare("SELECT id FROM forums WHERE id = ?").bind(id).first();
	if (!existing) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	// Check no threads
	const countResult = await env.DB.prepare("SELECT COUNT(*) as cnt FROM threads WHERE forum_id = ?")
		.bind(id)
		.first<{ cnt: number }>();
	if (countResult && countResult.cnt > 0) {
		return errorResponse("FORUM_HAS_THREADS", 409, { threadCount: countResult.cnt }, origin);
	}

	await env.DB.prepare("DELETE FROM forums WHERE id = ?").bind(id).run();

	return jsonResponse({ deleted: true, id }, origin);
});
